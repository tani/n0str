import { Database } from "bun:sqlite";
import type { Event, Filter } from "nostr-tools";
import { isAddressable, isReplaceable } from "../domain/nostr.ts";
import { logger } from "../utils/logger.ts";
import { segmentForFts, segmentSearchQuery } from "./fts.ts";
import type { IEventRepository, ExistingRow } from "../domain/types.ts";

// Redundant types removed for simplification

/**
 * SqliteEventRepository implements IEventRepository using Bun's native SQLite (bun:sqlite).
 * It handles event storage, retrieval, deletion, and search indexing with row-level streaming.
 * Maximizes SQLite's JSON features for performance and simplicity.
 */
export class SqliteEventRepository implements IEventRepository {
  public db: Database;
  private closed = false;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  async init(): Promise<void> {
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");

    // Maximize JSON features: Use GENERATED columns and STRICT mode
    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        event_json TEXT NOT NULL,
        pubkey TEXT GENERATED ALWAYS AS (json_extract(event_json, '$.pubkey')) VIRTUAL,
        created_at INTEGER GENERATED ALWAYS AS (json_extract(event_json, '$.created_at')) VIRTUAL,
        kind INTEGER GENERATED ALWAYS AS (json_extract(event_json, '$.kind')) VIRTUAL,
        content TEXT GENERATED ALWAYS AS (json_extract(event_json, '$.content')) VIRTUAL
      ) STRICT;
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
      ) STRICT;
    `);

    this.db.run("CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_tags_event_id ON tags(event_id);");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value);");

    // NIP-50: FTS5 Search Capability
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        id,
        content
      );
    `);

    // Triggers for automatic tag indexing and FTS sync
    this.db.run("DROP TRIGGER IF EXISTS events_ai");
    this.db.run(`
      CREATE TRIGGER events_ai AFTER INSERT ON events BEGIN
        INSERT INTO tags (event_id, name, value)
        SELECT new.id, json_extract(value, '$[0]'), json_extract(value, '$[1]')
        FROM json_each(new.event_json, '$.tags')
        WHERE json_extract(value, '$[0]') IS NOT NULL AND json_extract(value, '$[1]') IS NOT NULL;
      END;
    `);

    this.db.run("DROP TRIGGER IF EXISTS events_ad");
    this.db.run(`
      CREATE TRIGGER events_ad AFTER DELETE ON events BEGIN
        DELETE FROM events_fts WHERE id = old.id;
      END;
    `);
  }

  async saveEvent(event: Event): Promise<void> {
    void logger.trace`Saving event ${event.id} (kind: ${event.kind})`;
    this.db.transaction(() => {
      if (isReplaceable(event.kind)) {
        this.db
          .prepare(
            `DELETE FROM events WHERE kind = ? AND pubkey = ? AND (created_at < ? OR (created_at = ? AND id > ?))`,
          )
          .run(event.kind, event.pubkey, event.created_at, event.created_at, event.id);

        const newerExists = this.db
          .prepare(
            `SELECT 1 FROM events WHERE kind = ? AND pubkey = ? AND (created_at > ? OR (created_at = ? AND id < ?)) LIMIT 1`,
          )
          .get(event.kind, event.pubkey, event.created_at, event.created_at, event.id);
        if (newerExists) return;
      } else if (isAddressable(event.kind)) {
        const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
        this.db
          .prepare(
            `
          DELETE FROM events 
          WHERE kind = ? 
            AND pubkey = ? 
            AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ?)
            AND (created_at < ? OR (created_at = ? AND id > ?))
        `,
          )
          .run(event.kind, event.pubkey, dTag, event.created_at, event.created_at, event.id);

        const newerExists = this.db
          .prepare(
            `
          SELECT 1 FROM events 
          WHERE kind = ? 
            AND pubkey = ? 
            AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ?)
            AND (created_at > ? OR (created_at = ? AND id < ?))
          LIMIT 1
        `,
          )
          .get(event.kind, event.pubkey, dTag, event.created_at, event.created_at, event.id);
        if (newerExists) return;
      }

      const insertResult = this.db
        .prepare("INSERT INTO events (id, event_json) VALUES (?, ?) ON CONFLICT DO NOTHING")
        .run(event.id, JSON.stringify(event));

      if (insertResult.changes > 0) {
        // FTS still needs manual segmenting for now
        this.db
          .prepare("INSERT INTO events_fts(id, content) VALUES (?, ?)")
          .run(event.id, segmentForFts(event.content));
      }
    })();
    void logger.trace`Saved event ${event.id}`;
  }

  async clear(): Promise<void> {
    this.db.transaction(() => {
      this.db.run("DELETE FROM events");
      this.db.run("DELETE FROM tags");
      this.db.run("DELETE FROM events_fts");
    })();
  }

  async deleteEvents(
    pubkey: string,
    eventIds: string[],
    identifiers: string[],
    until: number = Infinity,
  ): Promise<void> {
    this.db.transaction(() => {
      if (eventIds.length > 0) {
        this.db
          .prepare(`DELETE FROM events WHERE pubkey = ? AND id IN (SELECT value FROM json_each(?))`)
          .run(pubkey, JSON.stringify(eventIds));
      }

      for (const addr of identifiers) {
        const parts = addr.split(":");
        if (parts.length < 3 || parts[1] !== pubkey) continue;
        const kind = parseInt(parts[0]!);
        const dTag = parts[2]!;

        this.db
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
      }
    })();
  }

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

  async countEvents(filters: Filter[]): Promise<number> {
    if (filters.length === 0) return 0;
    const queries: string[] = [];
    const allParams: unknown[] = [];

    for (const filter of filters) {
      const { clause, params } = this.buildWhereClause(filter);
      queries.push(`SELECT id FROM events ${clause}`);
      allParams.push(...params);
    }

    const queryStr = `SELECT COUNT(*) as count FROM ( ${queries.join(" UNION ")} )`;
    const result = this.db.prepare(queryStr).get(...(allParams as any[])) as {
      count: number;
    };
    return result?.count ?? 0;
  }

  async *queryEvents(filter: Filter): AsyncIterableIterator<Event> {
    const { clause, params } = this.buildWhereClause(filter);
    let baseQuery = `SELECT event_json FROM events ${clause} ORDER BY created_at DESC`;
    if (filter.limit !== undefined) {
      baseQuery += ` LIMIT ?`;
      params.push(filter.limit);
    }

    const stmt = this.db.prepare(baseQuery);
    try {
      for (const row of stmt.iterate(...(params as any[])) as IterableIterator<{
        event_json: string;
      }>) {
        yield JSON.parse(row.event_json);
      }
    } finally {
      stmt.finalize();
    }
  }

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
    const stmt = this.db.prepare(queryStr);
    try {
      for (const row of stmt.iterate(...(params as any[])) as IterableIterator<ExistingRow>) {
        yield row;
      }
    } finally {
      stmt.finalize();
    }
  }

  // --- Private Helper Methods ---

  private buildWhereClause(filter: Filter) {
    const clauses: string[] = [];
    const params: unknown[] = [];

    // NIP-40: Expiration
    clauses.push(
      "events.id NOT IN (SELECT event_id FROM tags WHERE name = 'expiration' AND CAST(value AS INTEGER) < ?)",
    );
    params.push(Math.floor(Date.now() / 1000));

    if (filter.ids?.length) {
      clauses.push(`events.id IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(filter.ids));
    }
    if (filter.authors?.length) {
      clauses.push(`events.pubkey IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(filter.authors));
    }
    if (filter.kinds?.length) {
      clauses.push(`events.kind IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(filter.kinds));
    }
    if (filter.since !== undefined) {
      clauses.push("events.created_at >= ?");
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      clauses.push("events.created_at <= ?");
      params.push(filter.until);
    }

    // NIP-12: Tag Queries
    for (const [key, values] of Object.entries(filter)) {
      if (key.startsWith("#") && Array.isArray(values) && values.length > 0) {
        clauses.push(
          `events.id IN (SELECT event_id FROM tags WHERE name = ? AND value IN (SELECT value FROM json_each(?)))`,
        );
        params.push(key.slice(1), JSON.stringify(values));
      }
    }

    // NIP-50: Search
    if (filter.search) {
      const searchQuery = segmentSearchQuery(filter.search);
      if (searchQuery) {
        clauses.push("events.id IN (SELECT id FROM events_fts WHERE events_fts MATCH ?)");
        params.push(searchQuery);
      }
    }

    return {
      clause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params,
    };
  }
}
