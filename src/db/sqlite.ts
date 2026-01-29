import { Database } from "bun:sqlite";
import type { Event, Filter } from "nostr-tools";
import { isAddressable, isReplaceable } from "../domain/nostr.ts";
import { logger } from "../utils/logger.ts";
import { segmentForFts, segmentSearchQuery } from "./fts.ts";
import type { IEventRepository, ExistingRow } from "../domain/types.ts";

type EventRow = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  sig: string;
};

// Removed TagRow type to avoid allocations in saveEvent

type EventWithTagRow = EventRow & {
  tag_name: string | null;
  tag_value: string | null;
};

type SqlCondition = { sql: string; params: unknown[] };
type FilterCondition = SqlCondition | { col: string; val: unknown; op?: string };

/**
 * SqliteEventRepository implements IEventRepository using Bun's native SQLite (bun:sqlite).
 * It handles event storage, retrieval, deletion, and search indexing with row-level streaming.
 */
export class SqliteEventRepository implements IEventRepository {
  public db: Database;
  private closed = false;

  /**
   * Creates an instance of SqliteEventRepository.
   * @param dbPath - The path to the SQLite database file.
   */
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  /**
   * Closes the database connection.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /**
   * Asynchronously disposes of the repository.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Initializes the database schema, indexes, and search triggers.
   */
  async init(): Promise<void> {
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind INTEGER NOT NULL,
        content TEXT NOT NULL,
        sig TEXT NOT NULL
      );
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value);");

    // NIP-50: FTS5 Search Capability
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        id,
        content
      );
    `);

    // Triggers for FTS5 sync
    this.db.run("DROP TRIGGER IF EXISTS events_ad");
    this.db.run(`
      CREATE TRIGGER events_ad AFTER DELETE ON events BEGIN
        DELETE FROM events_fts WHERE id = old.id;
      END;
    `);
    this.db.run("DROP TRIGGER IF EXISTS events_fts_cleanup");
  }

  /**
   * Saves a Nostr event to the database and updates the search index.
   * Handles replacement logic for replaceable and addressable events.
   * @param event - The Nostr event to save.
   */
  async saveEvent(event: Event): Promise<void> {
    this.db.transaction(() => {
      const existing = this.findExisting(event);
      if (existing) {
        if (this.isOlderEvent(event, existing)) return;
        this.db.prepare("DELETE FROM events WHERE id = ?").run(existing.id);
      }

      const insertResult = this.db
        .prepare(
          "INSERT INTO events (id, pubkey, created_at, kind, content, sig) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .run(event.id, event.pubkey, event.created_at, event.kind, event.content, event.sig);

      if (insertResult.changes > 0) {
        const ftsContent = segmentForFts(event.content);
        this.db
          .prepare("INSERT INTO events_fts(id, content) VALUES (?, ?)")
          .run(event.id, ftsContent);
      }

      for (const [name, value] of event.tags) {
        if (name && value) {
          this.db
            .prepare("INSERT INTO tags (event_id, name, value) VALUES (?, ?, ?)")
            .run(event.id, name, value);
        }
      }
    })();
    void logger.trace`Saved event ${event.id}`;
  }

  /**
   * Clears all data from the database.
   */
  async clear(): Promise<void> {
    this.db.transaction(() => {
      this.db.run("DELETE FROM events");
      this.db.run("DELETE FROM tags");
      this.db.run("DELETE FROM events_fts");
    })();
  }

  /**
   * Deletes events based on publication key, event IDs, and addressable identifiers.
   * Used for NIP-09 event deletions.
   * @param pubkey - The public key of the author requesting deletion.
   * @param eventIds - List of event IDs to delete.
   * @param identifiers - List of addressable event identifiers (kind:pubkey:d-tag).
   * @param until - Optional timestamp limit for deletion.
   */
  async deleteEvents(
    pubkey: string,
    eventIds: string[],
    identifiers: string[],
    until: number = Infinity,
  ): Promise<void> {
    this.db.transaction(() => {
      if (eventIds.length > 0) {
        const placeholders = eventIds.map(() => "?").join(", ");
        const res = this.db
          .prepare(`DELETE FROM events WHERE pubkey = ? AND id IN (${placeholders})`)
          .run(pubkey, ...eventIds);
        void logger.trace`Deleted ${res.changes} events by IDs for ${pubkey}`;
      }

      for (const addr of identifiers) {
        const parts = addr.split(":");
        if (parts.length < 3) continue;
        const kind = parseInt(parts[0]!);
        const pk = parts[1]!;
        const dTag = parts[2]!;

        if (pk !== pubkey) continue;

        const res = this.db
          .prepare(
            `
          DELETE FROM events
          WHERE kind = ?
            AND pubkey = ?
            AND created_at <= ?
            AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ?)
        `,
          )
          .run(kind, pubkey, until, dTag);
        if (res.changes > 0) {
          void logger.trace`Deleted ${res.changes} addressable events for ${pubkey} (${addr})`;
        }
      }
    })();
  }

  /**
   * Removes events that have expired based on their 'expiration' tag.
   * Follows NIP-40.
   */
  async cleanupExpiredEvents(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    this.db.transaction(() => {
      const result = this.db
        .prepare(
          `
        DELETE FROM events
        WHERE id IN (
          SELECT event_id
          FROM tags
          WHERE name = 'expiration'
          AND CAST(value AS INTEGER) < ?
        )
      `,
        )
        .run(now);
      if (result.changes > 0) {
        void logger.info`Cleaned up ${result.changes} expired events`;
      }
    })();
  }

  /**
   * Counts the number of events matching the given filters.
   * Follows NIP-45.
   * @param filters - List of Nostr filters.
   * @returns The total number of matching events.
   */
  async countEvents(filters: Filter[]): Promise<number> {
    let totalCount = 0;
    for (const filter of filters) {
      const { clause, params } = this.buildWhereClause(filter);
      const queryStr = `SELECT COUNT(*) as count FROM events ${clause}`;
      const result = this.db.prepare(queryStr).get(...(params as any[])) as {
        count: number;
      };
      totalCount += result?.count ?? 0;
    }
    void logger.trace`Counted ${totalCount} events`;
    return totalCount;
  }

  /**
   * Queries events matching a single Nostr filter.
   * @param filter - The Nostr filter.
   * @returns An async iterator of matching Nostr events.
   */
  async *queryEvents(filter: Filter): AsyncIterableIterator<Event> {
    const { clause, params } = this.buildWhereClause(filter);
    let baseQuery = `SELECT id, pubkey, created_at, kind, content, sig FROM events ${clause} ORDER BY created_at DESC`;
    if (filter.limit !== undefined) {
      baseQuery += ` LIMIT ?`;
      params.push(filter.limit);
    }

    const queryStr = `
      SELECT
        e.id,
        e.pubkey,
        e.created_at,
        e.kind,
        e.content,
        e.sig,
        t.name AS tag_name,
        t.value AS tag_value
      FROM (${baseQuery}) e
      LEFT JOIN tags t ON t.event_id = e.id
      ORDER BY e.created_at DESC, t.id ASC
    `;

    // Use Iterator.from() to wrap the iterable
    const rows = Iterator.from(
      this.db.prepare(queryStr).iterate(...(params as any[])) as IterableIterator<EventWithTagRow>,
    );

    let currentEvent: Event | undefined;
    for (const row of rows) {
      if (!currentEvent || currentEvent.id !== row.id) {
        if (currentEvent) {
          yield currentEvent;
        }
        currentEvent = {
          id: row.id,
          pubkey: row.pubkey,
          created_at: row.created_at,
          kind: row.kind,
          content: row.content,
          sig: row.sig,
          tags: [],
        };
      }

      if (row.tag_name !== null && row.tag_value !== null) {
        currentEvent.tags.push([row.tag_name, row.tag_value]);
      }
    }

    if (currentEvent) {
      yield currentEvent;
    }
  }

  /**
   * Queries events for negentropy sync.
   * @param filter - The Nostr filter.
   * @returns An async iterator of basic event info (id and created_at).
   */
  async *queryEventsForSync(filter: Filter): AsyncIterableIterator<ExistingRow> {
    const { clause, params } = this.buildWhereClause(filter);
    const queryStr = `
      SELECT id, created_at
      FROM events
      ${clause}
      ORDER BY created_at ASC, id ASC
      ${filter.limit ? `LIMIT ?` : ""}
    `;
    if (filter.limit) {
      params.push(filter.limit);
    }
    const rows = Iterator.from(
      this.db.prepare(queryStr).iterate(...(params as any[])) as IterableIterator<ExistingRow>,
    );

    let count = 0;
    // Use iterator helpers (map) + yield *
    yield* rows.map((row) => {
      count++;
      return row;
    });

    void logger.trace`Sync query returned ${count} events`;
  }

  // --- Private Helper Methods ---

  private toSqlCondition(c: FilterCondition): SqlCondition[] {
    if ("sql" in c) return c.params.length > 0 || c.sql.includes("expiration") ? [c] : [];
    if (c.val === undefined || (Array.isArray(c.val) && c.val.length === 0)) return [];
    if (Array.isArray(c.val)) {
      return [
        {
          sql: `${c.col} IN (${c.val.map(() => "?").join(", ")})`,
          params: c.val,
        },
      ];
    }
    return [{ sql: `${c.col} ${c.op ?? "="} ?`, params: [c.val] }];
  }

  private finalizeConditions(conditions: SqlCondition[]) {
    const params: unknown[] = [];
    const clauses = conditions.map(({ sql, params: p }) => {
      params.push(...p);
      return sql;
    });
    return {
      clause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params,
    };
  }

  private buildWhereClause(filter: Filter) {
    const now = Math.floor(Date.now() / 1000);
    const searchQuery = filter.search ? segmentSearchQuery(filter.search) : "";

    const rawConditions: FilterCondition[] = [
      {
        sql: "events.id NOT IN (SELECT event_id FROM tags WHERE name = 'expiration' AND CAST(value AS INTEGER) < ?)",
        params: [now],
      },
      { col: "events.id", val: filter.ids },
      { col: "events.pubkey", val: filter.authors },
      { col: "events.kind", val: filter.kinds },
      { col: "events.created_at", op: ">=", val: filter.since },
      { col: "events.created_at", op: "<=", val: filter.until },
      ...Object.entries(filter).flatMap(([k, v]): FilterCondition[] =>
        k.startsWith("#") && Array.isArray(v) && v.length > 0
          ? [
              {
                sql: `events.id IN (SELECT event_id FROM tags WHERE name = ? AND value IN (${v.map(() => "?").join(", ")}))`,
                params: [k.slice(1), ...v],
              },
            ]
          : [],
      ),
    ];

    if (searchQuery) {
      rawConditions.push({
        sql: "events.id IN (SELECT id FROM events_fts WHERE events_fts MATCH ?)",
        params: [searchQuery],
      });
    }

    return this.finalizeConditions(rawConditions.flatMap((c) => this.toSqlCondition(c)));
  }

  private isOlderEvent(candidate: Event, existing: ExistingRow) {
    return (
      candidate.created_at < existing.created_at ||
      (candidate.created_at === existing.created_at && candidate.id > existing.id)
    );
  }

  private findExisting(event: Event): ExistingRow | undefined {
    if (isReplaceable(event.kind)) {
      return this.db
        .prepare(
          "SELECT id, created_at FROM events WHERE kind = ? AND pubkey = ? ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .get(event.kind, event.pubkey) as ExistingRow | undefined;
    }
    if (isAddressable(event.kind)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
      return this.db
        .prepare(
          "SELECT id, created_at FROM events WHERE kind = ? AND pubkey = ? AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ?) ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .get(event.kind, event.pubkey, dTag) as ExistingRow | undefined;
    }
  }
}
