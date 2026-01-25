import * as schema from "./schema";
import { and, gte, lte, inArray, notInArray, sql, eq, count } from "drizzle-orm";
import type { Event, Filter } from "nostr-tools";
import { isReplaceable, isAddressable } from "./protocol.ts";
import { db } from "./init";

export { db };

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
      await tx.delete(schema.events).where(
        and(
          eq(schema.events.kind, kind),
          eq(schema.events.pubkey, pubkey),
          lte(schema.events.created_at, until),
          inArray(
            schema.events.id,
            db
              .select({ id: schema.tags.eventId })
              .from(schema.tags)
              .where(and(eq(schema.tags.name, "d"), eq(schema.tags.value, dTag))),
          ),
        ),
      );
    }
  });
}

export async function cleanupExpiredEvents() {
  const now = Math.floor(Date.now() / 1000);
  await db.transaction(async (tx) => {
    await tx.delete(schema.events).where(
      inArray(
        schema.events.id,
        db
          .select({ id: schema.tags.eventId })
          .from(schema.tags)
          .where(
            and(
              eq(schema.tags.name, "expiration"),
              sql`CAST(${schema.tags.value} AS INTEGER) < ${now}`,
            ),
          ),
      ),
    );
  });
}

function getFilterConditions(filter: Filter) {
  const now = Math.floor(Date.now() / 1000);
  const conditions = [];

  // NIP-40: Filter out expired events
  conditions.push(
    // NIP-40: Filter out expired events
    notInArray(
      schema.events.id,
      db
        .select({ id: schema.tags.eventId })
        .from(schema.tags)
        .where(
          and(
            eq(schema.tags.name, "expiration"),
            sql`CAST(${schema.tags.value} AS INTEGER) < ${now}`,
          ),
        ),
    ),
  );

  if (filter.ids) conditions.push(inArray(schema.events.id, filter.ids));
  if (filter.authors) conditions.push(inArray(schema.events.pubkey, filter.authors));
  if (filter.kinds) conditions.push(inArray(schema.events.kind, filter.kinds));
  if (filter.since !== undefined) conditions.push(gte(schema.events.created_at, filter.since));
  if (filter.until !== undefined) conditions.push(lte(schema.events.created_at, filter.until));

  if (filter.search) {
    conditions.push(
      inArray(
        schema.events.id,
        db
          .select({ id: schema.eventsFts.id })
          .from(schema.eventsFts)
          .where(sql`events_fts MATCH ${filter.search}`),
      ),
    );
  }

  // Tag filters using SQL fallback for dynamic keys
  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#") && Array.isArray(values)) {
      const tagName = key.substring(1);
      conditions.push(
        inArray(
          schema.events.id,
          db
            .select({ id: schema.tags.eventId })
            .from(schema.tags)
            .where(
              and(eq(schema.tags.name, tagName), inArray(schema.tags.value, values as string[])),
            ),
        ),
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
      .select({ count: count() })
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
