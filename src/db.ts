import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { and, gte, lte, inArray, sql } from "drizzle-orm";
import type { Event, Filter } from "nostr-tools";

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
db.run(
  sql`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);`,
);
db.run(sql`CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);`);
db.run(
  sql`CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value);`,
);

export async function saveEvent(event: Event) {
  await db.transaction(async (tx) => {
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

export async function queryEvents(filter: Filter): Promise<Event[]> {
  const conditions = [];
  if (filter.ids) conditions.push(inArray(schema.events.id, filter.ids));
  if (filter.authors)
    conditions.push(inArray(schema.events.pubkey, filter.authors));
  if (filter.kinds) conditions.push(inArray(schema.events.kind, filter.kinds));
  if (filter.since !== undefined)
    conditions.push(gte(schema.events.created_at, filter.since));
  if (filter.until !== undefined)
    conditions.push(lte(schema.events.created_at, filter.until));

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
