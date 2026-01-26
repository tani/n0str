import { PGlite } from "@electric-sql/pglite";
import type { Event, Filter } from "nostr-tools";
import { isAddressable, isReplaceable } from "./nostr.ts";
import { logger } from "./logger.ts";
import { segmentForFts, segmentSearchQuery } from "./fts.ts";
import type { IEventRepository, ExistingRow } from "./types.ts";

type EventRow = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  sig: string;
};

type TagRow = {
  event_id: string;
  name: string;
  value: string;
};

type EventWithTagRow = EventRow & {
  tag_name: string | null;
  tag_value: string | null;
};

type SqlCondition = { sql: string; params: unknown[] };
type FilterCondition = SqlCondition | { col: string; val: unknown; op?: string };

/**
 * PgLiteEventRepository implements IEventRepository using PGlite (PostgreSQL in WASM).
 * It handles event storage, retrieval, deletion, and search indexing.
 */
export class PgLiteEventRepository implements IEventRepository {
  public db: PGlite;
  private closed = false;

  /**
   * Creates an instance of PgLiteEventRepository.
   * @param dbPath - The path to the PGlite data directory. If undefined, uses in-memory.
   */
  constructor(dbPath?: string) {
    this.db = new PGlite(dbPath);
  }

  /**
   * Closes the database connection.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.db.close();
  }

  /**
   * Asynchronously disposes of the repository.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Initializes the database schema, indexes, and search columns.
   */
  async init(): Promise<void> {
    // Note: Foreign keys are generally supported but strict enforcement depends on config.
    // PGlite defaults usually work fine.

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        kind INTEGER NOT NULL,
        content TEXT NOT NULL,
        sig TEXT NOT NULL,
        fts tsvector
      );
    `);

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
    `);

    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value);`);
    await this.db.exec(`CREATE INDEX IF NOT EXISTS idx_events_fts ON events USING GIN (fts);`);
  }

  /**
   * Saves a Nostr event to the database.
   * Handles replacement logic for replaceable and addressable events.
   * @param event - The Nostr event to save.
   */
  async saveEvent(event: Event): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await this.findExisting(tx, event);
      if (existing) {
        if (this.isOlderEvent(event, existing)) return;
        await tx.query(`DELETE FROM events WHERE id = $1`, [existing.id]);
      }

      const ftsContent = segmentForFts(event.content);

      const insertQuery = `
        INSERT INTO events (id, pubkey, created_at, kind, content, sig, fts)
        VALUES ($1, $2, $3, $4, $5, $6, to_tsvector('simple', $7))
        ON CONFLICT DO NOTHING
      `;
      const insertResult = await tx.query(insertQuery, [
        event.id,
        event.pubkey,
        event.created_at,
        event.kind,
        event.content,
        event.sig,
        ftsContent,
      ]);

      // insertResult.affectedRows gives the number of rows inserted
      if ((insertResult.affectedRows ?? 0) > 0) {
        const tagRows = this.buildTagRows(event);
        if (tagRows.length > 0) {
          // Bulk insert tags
          // PGlite supports parameterized queries, but for bulk insert we might need to construct the query or do loop
          // For simplicity and safety against SQL injection, we'll do loop or construct parameterized values string
          // ($1, $2, $3), ($4, $5, $6), ...

          const valueStrings: string[] = [];
          const params: unknown[] = [];
          tagRows.forEach((row, i) => {
            const offset = i * 3;
            valueStrings.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
            params.push(row.event_id, row.name, row.value);
          });

          if (valueStrings.length > 0) {
            await tx.query(
              `INSERT INTO tags (event_id, name, value) VALUES ${valueStrings.join(", ")}`,
              params,
            );
          }
        }
      }
    });
    void logger.trace`Saved event ${event.id}`;
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
    await this.db.transaction(async (tx) => {
      if (eventIds.length > 0) {
        // Build placeholders for eventIds
        const placeholders = eventIds.map((_, i) => `$${i + 2}`).join(", ");
        const res = await tx.query(
          `DELETE FROM events WHERE pubkey = $1 AND id IN (${placeholders})`,
          [pubkey, ...eventIds],
        );
        void logger.trace`Deleted ${res.affectedRows} events by IDs for ${pubkey}`;
      }

      for (const addr of identifiers) {
        const parts = addr.split(":");
        if (parts.length < 3) continue;
        const kind = parseInt(parts[0]!);
        const pk = parts[1]!;
        const dTag = parts[2]!;

        if (pk !== pubkey) continue;

        const res = await tx.query(
          `DELETE FROM events
           WHERE kind = $1
             AND pubkey = $2
             AND created_at <= $3
             AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = $4)`,
          [kind, pubkey, until, dTag],
        );

        if ((res.affectedRows ?? 0) > 0) {
          void logger.trace`Deleted ${res.affectedRows} addressable events for ${pubkey} (${addr})`;
        }
      }
    });
  }

  /**
   * Removes events that have expired based on their 'expiration' tag.
   * Follows NIP-40.
   */
  async cleanupExpiredEvents(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db.transaction(async (tx) => {
      const result = await tx.query(
        `DELETE FROM events
         WHERE id IN (
           SELECT event_id
           FROM tags
           WHERE name = 'expiration'
           AND CAST(value AS INTEGER) < $1
         )`,
        [now],
      );
      if ((result.affectedRows ?? 0) > 0) {
        void logger.info`Cleaned up ${result.affectedRows} expired events`;
      }
    });
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
      const query = `SELECT COUNT(*) as count FROM events ${clause}`;
      const result = await this.db.query<{ count: number }>(query, params);
      totalCount += Number(result.rows[0]?.count ?? 0);
    }
    void logger.trace`Counted ${totalCount} events`;
    return totalCount;
  }

  /**
   * Queries events matching a single Nostr filter.
   * @param filter - The Nostr filter.
   * @returns A list of matching Nostr events.
   */
  async queryEvents(filter: Filter): Promise<Event[]> {
    const { clause, params } = this.buildWhereClause(filter);
    let baseQuery = `SELECT id, pubkey, created_at, kind, content, sig FROM events ${clause} ORDER BY created_at DESC`;
    if (filter.limit !== undefined) {
      baseQuery += ` LIMIT $${params.length + 1}`;
      params.push(filter.limit);
    }

    const query = `
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

    const result = await this.db.query<EventWithTagRow>(query, params);
    const rows = result.rows;
    if (rows.length === 0) return [];

    const events = new Map<string, Event>();
    for (const row of rows) {
      let event = events.get(row.id);
      if (!event) {
        event = {
          id: row.id,
          pubkey: row.pubkey,
          created_at: Number(row.created_at), // BigInt to number (safe for Nostr timestamps)
          kind: row.kind,
          content: row.content,
          sig: row.sig,
          tags: [],
        };
        events.set(row.id, event);
      }

      if (row.tag_name !== null && row.tag_value !== null) {
        event.tags.push([row.tag_name, row.tag_value]);
      }
    }

    const eventList = Array.from(events.values());
    void logger.trace`Query returned ${eventList.length} events`;
    return eventList;
  }

  /**
   * Queries events for negentropy sync.
   * @param filter - The Nostr filter.
   * @returns A list of basic event info (id and created_at).
   */
  async queryEventsForSync(filter: Filter): Promise<ExistingRow[]> {
    const { clause, params } = this.buildWhereClause(filter);
    const query = `
      SELECT id, created_at
      FROM events
      ${clause}
      ORDER BY created_at ASC, id ASC
    `;
    const result = await this.db.query<{ id: string; created_at: number }>(query, params);
    // Convert created_at from potentially BigInt/string to number
    return result.rows.map((r) => ({ ...r, created_at: Number(r.created_at) }));
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
      let built = sql;
      for (const v of p) {
        params.push(v);
        built = built.replace("?", `$${params.length}`);
      }
      return built;
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
      {
        sql: "events.fts @@ websearch_to_tsquery('simple', ?)",
        params: searchQuery ? [searchQuery] : [],
      },
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

    return this.finalizeConditions(rawConditions.flatMap((c) => this.toSqlCondition(c)));
  }

  private isOlderEvent(candidate: Event, existing: ExistingRow) {
    return (
      candidate.created_at < existing.created_at ||
      (candidate.created_at === existing.created_at && candidate.id > existing.id)
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async findExisting(tx: any, event: Event): Promise<ExistingRow | undefined> {
    if (isReplaceable(event.kind)) {
      const res = (await tx.query(
        `
        SELECT id, created_at FROM events
        WHERE kind = $1 AND pubkey = $2
        ORDER BY created_at DESC, id DESC LIMIT 1
      `,
        [event.kind, event.pubkey],
      )) as { rows: { id: string; created_at: number }[] };
      const row = res.rows[0];
      return row ? { ...row, created_at: Number(row.created_at) } : undefined;
    }
    if (isAddressable(event.kind)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
      const res = (await tx.query(
        `
        SELECT id, created_at FROM events
        WHERE kind = $1 AND pubkey = $2
        AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = $3)
        ORDER BY created_at DESC, id DESC LIMIT 1
      `,
        [event.kind, event.pubkey, dTag],
      )) as { rows: { id: string; created_at: number }[] };
      const row = res.rows[0];
      return row ? { ...row, created_at: Number(row.created_at) } : undefined;
    }
    return undefined;
  }

  private buildTagRows(event: Event): TagRow[] {
    return event.tags.flatMap(([name, value]) =>
      name && value ? [{ event_id: event.id, name, value }] : [],
    );
  }
}
