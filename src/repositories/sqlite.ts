import { SQL } from "bun";
import type { Event, Filter } from "nostr-tools";
import { isAddressable, isReplaceable } from "../utils/nostr.ts";
import { logger } from "../utils/logger.ts";
import { segmentForFts, segmentSearchQuery } from "../utils/fts.ts";
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

export class SqliteEventRepository implements IEventRepository {
  public db: SQL;

  constructor(dbPath: string = process.env.DATABASE_PATH || "n0str.db") {
    this.db = new SQL({
      adapter: "sqlite",
      filename: dbPath,
    });
  }

  async init(): Promise<void> {
    await this.db`PRAGMA foreign_keys = ON`;

    await this.db`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind INTEGER NOT NULL,
        content TEXT NOT NULL,
        sig TEXT NOT NULL
      );
    `;
    await this.db`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      );
    `;
    await this.db`CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);`;
    await this.db`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);`;
    await this.db`CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);`;
    await this.db`CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value);`;

    // NIP-50: FTS5 Search Capability
    await this.db`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        id,
        content
      );
    `;

    // Triggers for FTS5 sync
    await this.db`DROP TRIGGER IF EXISTS events_ai`;

    await this.db`
      CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
        DELETE FROM events_fts WHERE id = old.id;
      END;
    `;
  }

  async saveEvent(event: Event): Promise<void> {
    await this.db.begin(async (tx) => {
      const existing = await this.findExisting(tx, event);
      if (existing) {
        if (this.isOlderEvent(event, existing)) return;
        await tx`DELETE FROM events WHERE id = ${existing.id}`;
      }

      const insertResult = await tx`
        INSERT INTO events ${tx(event, "id", "pubkey", "created_at", "kind", "content", "sig")}
        ON CONFLICT DO NOTHING
      `;
      if ((insertResult?.count ?? 0) > 0) {
        const ftsContent = segmentForFts(event.content);
        await tx`INSERT INTO events_fts(id, content) VALUES (${event.id}, ${ftsContent})`;
      }

      const tagRows = this.buildTagRows(event);
      if (tagRows.length > 0) {
        await tx`INSERT INTO tags ${tx(tagRows)}`;
      }
    });
    void logger.trace`Saved event ${event.id}`;
  }

  async deleteEvents(
    pubkey: string,
    eventIds: string[],
    identifiers: string[],
    until: number = Infinity,
  ): Promise<void> {
    await this.db.begin(async (tx) => {
      if (eventIds.length > 0) {
        const res = await tx`
          DELETE FROM events
          WHERE pubkey = ${pubkey}
            AND id IN ${tx(eventIds)}
        `;
        void logger.trace`Deleted ${res.count} events by IDs for ${pubkey}`;
      }

      for (const addr of identifiers) {
        const parts = addr.split(":");
        if (parts.length < 3) continue;
        const kind = parseInt(parts[0]!);
        const pk = parts[1]!;
        const dTag = parts[2]!;

        if (pk !== pubkey) continue;

        const res = await tx`
          DELETE FROM events
          WHERE kind = ${kind}
            AND pubkey = ${pubkey}
            AND created_at <= ${until}
            AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ${dTag})
        `;
        if (res.count > 0) {
          void logger.trace`Deleted ${res.count} addressable events for ${pubkey} (${addr})`;
        }
      }
    });
  }

  async cleanupExpiredEvents(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db.begin(async (tx) => {
      const result = await tx`
        DELETE FROM events
        WHERE id IN (
          SELECT event_id
          FROM tags
          WHERE name = 'expiration'
          AND CAST(value AS INTEGER) < ${now}
        )
      `;
      if (result.count > 0) {
        void logger.info`Cleaned up ${result.count} expired events`;
      }
    });
  }

  async countEvents(filters: Filter[]): Promise<number> {
    let totalCount = 0;
    for (const filter of filters) {
      const { clause, params } = this.buildWhereClause(filter);
      const query = `SELECT COUNT(*) as count FROM events ${clause}`;
      const result = await this.db.unsafe<{ count: number }[]>(query, params);
      totalCount += result[0]?.count ?? 0;
    }
    void logger.trace`Counted ${totalCount} events`;
    return totalCount;
  }

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

    const rows = await this.db.unsafe<EventWithTagRow[]>(query, params);
    if (rows.length === 0) return [];

    const events = new Map<string, Event>();
    for (const row of rows) {
      let event = events.get(row.id);
      if (!event) {
        event = {
          id: row.id,
          pubkey: row.pubkey,
          created_at: row.created_at,
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

    const result = Array.from(events.values());
    void logger.trace`Query returned ${result.length} events`;
    return result;
  }

  async queryEventsForSync(filter: Filter): Promise<ExistingRow[]> {
    const { clause, params } = this.buildWhereClause(filter);
    const query = `
      SELECT id, created_at
      FROM events
      ${clause}
      ORDER BY created_at ASC, id ASC
    `;
    const result = await this.db.unsafe<ExistingRow[]>(query, params);
    void logger.trace`Sync query returned ${result.length} events`;
    return result;
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
        sql: "events.id IN (SELECT id FROM events_fts WHERE events_fts MATCH ?)",
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

  private async findExisting(tx: SQL, event: Event): Promise<ExistingRow | undefined> {
    if (isReplaceable(event.kind)) {
      return (
        await tx<ExistingRow[]>`
        SELECT id, created_at FROM events
        WHERE kind = ${event.kind} AND pubkey = ${event.pubkey}
        ORDER BY created_at DESC, id DESC LIMIT 1
      `
      )[0];
    }
    if (isAddressable(event.kind)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
      return (
        await tx<ExistingRow[]>`
        SELECT id, created_at FROM events
        WHERE kind = ${event.kind} AND pubkey = ${event.pubkey}
        AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ${dTag})
        ORDER BY created_at DESC, id DESC LIMIT 1
      `
      )[0];
    }
  }

  private buildTagRows(event: Event): TagRow[] {
    return event.tags.flatMap(([name, value]) =>
      name && value ? [{ event_id: event.id, name, value }] : [],
    );
  }
}
