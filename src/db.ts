import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { and, gte, lte, inArray, sql, eq } from "drizzle-orm";
import type { Event, Filter } from "nostr-tools";
import { isReplaceable, isAddressable } from "./protocol.ts";

const dbPath = process.env.DATABASE_PATH || "nostra.db";
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });

// Initialization - using Drizzle run
db.run(sql`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    kind INTEGER NOT NULL,
    content TEXT NOT NULL,
    sig TEXT NOT NULL
  );
`);
db.run(sql`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
  );
`);
db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);`);
db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);`);
db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);`);
db.run(sql`CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value);`);

// NIP-50: FTS5 Search Capability (Internal content for reliability)
db.run(sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
    id,
    content
  );
`);

// Triggers for FTS5 sync
db.run(sql`
  CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(id, content) VALUES (new.id, new.content);
  END;
`);

db.run(sql`
  CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
    DELETE FROM events_fts WHERE id = old.id;
  END;
`);

export async function saveEvent(event: Event) {
  await db.transaction(async (tx) => {
    if (isReplaceable(event.kind)) {
      const existing = await tx.query.events.findFirst({
        where: and(eq(schema.events.kind, event.kind), eq(schema.events.pubkey, event.pubkey)),
        orderBy: (events, { desc }) => [desc(events.created_at), desc(events.id)],
      });

      if (existing) {
        if (
          event.created_at < existing.created_at ||
          (event.created_at === existing.created_at && event.id > existing.id)
        ) {
          return;
        }
        await tx.delete(schema.events).where(eq(schema.events.id, existing.id));
      }
    } else if (isAddressable(event.kind)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
      const existing = await tx.query.events.findFirst({
        where: and(
          eq(schema.events.kind, event.kind),
          eq(schema.events.pubkey, event.pubkey),
          sql`id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ${dTag})`,
        ),
        orderBy: (events, { desc }) => [desc(events.created_at), desc(events.id)],
      });

      if (existing) {
        if (
          event.created_at < existing.created_at ||
          (event.created_at === existing.created_at && event.id > existing.id)
        ) {
          return;
        }
        await tx.delete(schema.events).where(eq(schema.events.id, existing.id));
      }
    }

    await tx
      .insert(schema.events)
      .values({
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        content: event.content,
        sig: event.sig,
      })
      .onConflictDoNothing();

    for (const tag of event.tags) {
      if (tag[0] !== undefined && tag[1] !== undefined) {
        await tx.insert(schema.tags).values({
          eventId: event.id,
          name: tag[0],
          value: tag[1],
        });
      }
    }
  });
}

export async function deleteEvents(
  pubkey: string,
  eventIds: string[],
  identifiers: string[] = [],
  until: number = Infinity,
) {
  await db.transaction(async (tx) => {
    // Delete by event IDs (e tags)
    if (eventIds.length > 0) {
      await tx
        .delete(schema.events)
        .where(and(inArray(schema.events.id, eventIds), eq(schema.events.pubkey, pubkey)));
    }

    // Delete by identifiers (a tags: kind:pubkey:d-identifier)
    for (const addr of identifiers) {
      const parts = addr.split(":");
      if (parts.length < 3) continue;
      const kind = parseInt(parts[0]!);
      const pk = parts[1]!;
      const dTag = parts[2]!;

      // Only delete if the pubkey matches the author of the deletion request
      if (pk !== pubkey) continue;

      // Find events with matching kind, pubkey, and d-tag (using subquery for d-tag)
      await tx
        .delete(schema.events)
        .where(
          and(
            eq(schema.events.kind, kind),
            eq(schema.events.pubkey, pubkey),
            lte(schema.events.created_at, until),
            sql`id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ${dTag})`,
          ),
        );
    }
  });
}

export async function cleanupExpiredEvents() {
  const now = Math.floor(Date.now() / 1000);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.events)
      .where(
        sql`id IN (SELECT event_id FROM tags WHERE name = 'expiration' AND CAST(value AS INTEGER) < ${now})`,
      );
  });
}

function getFilterConditions(filter: Filter) {
  const now = Math.floor(Date.now() / 1000);
  const conditions = [];

  // NIP-40: Filter out expired events
  conditions.push(
    sql`events.id NOT IN (SELECT event_id FROM tags WHERE name = 'expiration' AND CAST(value AS INTEGER) < ${now})`,
  );

  if (filter.ids) conditions.push(inArray(schema.events.id, filter.ids));
  if (filter.authors) conditions.push(inArray(schema.events.pubkey, filter.authors));
  if (filter.kinds) conditions.push(inArray(schema.events.kind, filter.kinds));
  if (filter.since !== undefined) conditions.push(gte(schema.events.created_at, filter.since));
  if (filter.until !== undefined) conditions.push(lte(schema.events.created_at, filter.until));

  if (filter.search) {
    conditions.push(
      sql`events.id IN (SELECT id FROM events_fts WHERE events_fts MATCH ${filter.search})`,
    );
  }

  // Tag filters using SQL fallback for dynamic keys
  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#") && Array.isArray(values)) {
      const tagName = key.substring(1);
      const valuesSql = sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      );
      conditions.push(
        sql`events.id IN (SELECT event_id FROM tags WHERE name = ${tagName} AND value IN (${valuesSql}))`,
      );
    }
  }
  return conditions;
}

export async function countEvents(filters: Filter[]): Promise<number> {
  let totalCount = 0;
  for (const filter of filters) {
    const conditions = getFilterConditions(filter);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.events)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    totalCount += result[0]?.count || 0;
  }
  return totalCount;
}

export async function queryEvents(filter: Filter): Promise<Event[]> {
  const conditions = getFilterConditions(filter);

  const rows = await db.query.events.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: (events, { desc }) => [desc(events.created_at)],
    limit: filter.limit,
    with: {
      tags: {
        columns: {
          name: true,
          value: true,
        },
      },
    },
  });

  return rows.map((row: any) => ({
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    content: row.content,
    sig: row.sig,
    tags: row.tags.map((t: any) => [t.name, t.value]),
  }));
}
