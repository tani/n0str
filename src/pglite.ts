import { PGlite } from "@electric-sql/pglite";
import type { Event, Filter } from "nostr-tools";
import { isAddressable, isReplaceable } from "./nostr.ts";
import { logger } from "./logger.ts";
import { segmentForFts, segmentSearchQuery } from "./fts.ts";
import type { IEventRepository, ExistingRow } from "./types.ts";

/**
 * PgliteEventRepository implements IEventRepository using PGlite (WASM Postgres).
 * It handles event storage, retrieval, deletion, and search indexing using Postgres features.
 */
export class PgliteEventRepository implements IEventRepository {
  private db: PGlite;
  private closed = false;

  /**
   * Creates an instance of PgliteEventRepository.
   * @param dbPath - The path to the PGlite database directory.
   */
  constructor(dbPath?: string) {
    this.db = new PGlite(dbPath === ":memory:" ? undefined : dbPath);
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
   * Initializes the database schema, indexes, and search triggers.
   */
  async init(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind INTEGER NOT NULL,
        content TEXT NOT NULL,
        sig TEXT NOT NULL,
        content_tsvector tsvector
      );

      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
      CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value);
      CREATE INDEX IF NOT EXISTS idx_events_content_tsvector ON events USING gin(content_tsvector);
    `);
  }

  /**
   * Saves a Nostr event to the database and updates the search index.
   * Handles replacement logic for replaceable and addressable events.
   * @param event - The Nostr event to save.
   */
  async saveEvent(event: Event): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await this.findExisting(tx, event);
      if (existing) {
        if (this.isOlderEvent(event, existing)) return;
        await tx.query("DELETE FROM events WHERE id = $1", [existing.id]);
      }

      const ftsContent = segmentForFts(event.content);
      const res = await tx.query<{ id: string }>(
        `INSERT INTO events (id, pubkey, created_at, kind, content, sig, content_tsvector)
         VALUES ($1, $2, $3, $4, $5, $6, to_tsvector('simple', $7))
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          event.id,
          event.pubkey,
          event.created_at,
          event.kind,
          event.content,
          event.sig,
          ftsContent,
        ],
      );

      if (res.rows.length > 0) {
        for (const [name, value] of event.tags) {
          if (name && value) {
            await tx.query("INSERT INTO tags (event_id, name, value) VALUES ($1, $2, $3)", [
              event.id,
              name,
              value,
            ]);
          }
        }
      }
    });
    void logger.trace`Saved event ${event.id} (pglite)`;
  }

  /**
   * Clears all data from the database.
   */
  async clear(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query("DELETE FROM events");
      await tx.query("DELETE FROM tags");
    });
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
        await tx.query("DELETE FROM events WHERE pubkey = $1 AND id = ANY($2)", [pubkey, eventIds]);
      }

      for (const addr of identifiers) {
        const parts = addr.split(":");
        if (parts.length < 3) continue;
        const kind = parseInt(parts[0]!);
        const pk = parts[1]!;
        const dTag = parts[2]!;

        if (pk !== pubkey) continue;

        await tx.query(
          `DELETE FROM events
           WHERE kind = $1
             AND pubkey = $2
             AND created_at <= $3
             AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = $4)`,
          [kind, pubkey, until, dTag],
        );
      }
    });
  }

  /**
   * Removes events that have expired based on their 'expiration' tag.
   * Follows NIP-40.
   */
  async cleanupExpiredEvents(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.query(
      `DELETE FROM events
       WHERE id IN (
         SELECT event_id
         FROM tags
         WHERE name = 'expiration'
         AND CAST(value AS INTEGER) < $1
       )`,
      [now],
    );
    if (result.affectedRows && result.affectedRows > 0) {
      void logger.info`Cleaned up ${result.affectedRows} expired events (pglite)`;
    }
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
      const { sql, params } = this.buildWhereClause(filter);
      const result = await this.db.query<{ count: string | number }>(
        `SELECT COUNT(*) as count FROM events ${sql}`,
        params,
      );
      const count = result.rows[0]?.count;
      totalCount += typeof count === "string" ? parseInt(count) : (count ?? 0);
    }
    return totalCount;
  }

  /**
   * Queries events matching a single Nostr filter.
   * @param filter - The Nostr filter.
   * @returns A list of matching Nostr events.
   */
  async queryEvents(filter: Filter): Promise<Event[]> {
    const { sql, params } = this.buildWhereClause(filter);
    let baseQuery = `SELECT id, pubkey, created_at, kind, content, sig FROM events ${sql} ORDER BY created_at DESC`;

    if (filter.limit !== undefined) {
      params.push(filter.limit);
      baseQuery += ` LIMIT $${params.length}`;
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

    const result = await this.db.query<any>(query, params);
    const rows = result.rows;
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

    return Array.from(events.values());
  }

  /**
   * Queries events for negentropy sync.
   * @param filter - The Nostr filter.
   * @returns A list of basic event info (id and created_at).
   */
  async queryEventsForSync(filter: Filter): Promise<ExistingRow[]> {
    const { sql, params } = this.buildWhereClause(filter);
    const query = `
      SELECT id, created_at
      FROM events
      ${sql}
      ORDER BY created_at ASC, id ASC
    `;
    const result = await this.db.query<ExistingRow>(query, params);
    return result.rows;
  }

  private buildWhereClause(filter: Filter): { sql: string; params: any[] } {
    const params: any[] = [];
    const conditions: string[] = [];

    const now = Math.floor(Date.now() / 1000);
    params.push(now);
    conditions.push(
      `events.id NOT IN (SELECT event_id FROM tags WHERE name = 'expiration' AND CAST(value AS INTEGER) < $${params.length})`,
    );

    if (filter.ids) {
      params.push(filter.ids);
      conditions.push(`events.id = ANY($${params.length})`);
    }

    if (filter.authors) {
      params.push(filter.authors);
      conditions.push(`events.pubkey = ANY($${params.length})`);
    }

    if (filter.kinds) {
      params.push(filter.kinds);
      conditions.push(`events.kind = ANY($${params.length})`);
    }

    if (filter.since !== undefined) {
      params.push(filter.since);
      conditions.push(`events.created_at >= $${params.length}`);
    }

    if (filter.until !== undefined) {
      params.push(filter.until);
      conditions.push(`events.created_at <= $${params.length}`);
    }

    if (filter.search) {
      const search = segmentSearchQuery(filter.search);
      params.push(search);
      conditions.push(`events.content_tsvector @@ plainto_tsquery('simple', $${params.length})`);
    }

    for (const [key, val] of Object.entries(filter)) {
      if (key.startsWith("#") && Array.isArray(val) && val.length > 0) {
        const tagName = key.slice(1);
        params.push(tagName);
        const nameIdx = params.length;
        params.push(val);
        const valIdx = params.length;
        conditions.push(
          `events.id IN (SELECT event_id FROM tags WHERE name = $${nameIdx} AND value = ANY($${valIdx}))`,
        );
      }
    }

    const sql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return { sql, params };
  }

  private isOlderEvent(candidate: Event, existing: ExistingRow) {
    return (
      candidate.created_at < existing.created_at ||
      (candidate.created_at === existing.created_at && candidate.id > existing.id)
    );
  }

  private async findExisting(tx: any, event: Event): Promise<ExistingRow | undefined> {
    if (isReplaceable(event.kind)) {
      const res = await tx.query(
        "SELECT id, created_at FROM events WHERE kind = $1 AND pubkey = $2 ORDER BY created_at DESC, id DESC LIMIT 1",
        [event.kind, event.pubkey],
      );
      return res.rows[0];
    }
    if (isAddressable(event.kind)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
      const res = await tx.query(
        `SELECT id, created_at FROM events
         WHERE kind = $1 AND pubkey = $2
         AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = $3)
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [event.kind, event.pubkey, dTag],
      );
      return res.rows[0];
    }
    return undefined;
  }
}
