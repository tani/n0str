import type { Event, Filter } from "nostr-tools";
import { isReplaceable, isAddressable } from "./protocol.ts";
import { db } from "./init";

export { db };

type EventRow = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  sig: string;
};

type ExistingRow = Pick<EventRow, "id" | "created_at">;

type TagRow = {
  event_id: string;
  name: string;
  value: string;
};

function buildWhereClause(filter: Filter) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const add = (clause: string, values: readonly unknown[] = []) => {
    let built = clause;
    for (const value of values) {
      const placeholder = `$${params.length + 1}`;
      built = built.replace("?", placeholder);
      params.push(value);
    }
    clauses.push(built);
  };

  const addIn = (column: string, values?: readonly unknown[]) => {
    if (!values || values.length === 0) return;
    const placeholders = values.map((_, idx) => `$${params.length + idx + 1}`).join(", ");
    params.push(...values);
    clauses.push(`${column} IN (${placeholders})`);
  };

  const now = Math.floor(Date.now() / 1000);
  add(
    "events.id NOT IN (SELECT event_id FROM tags WHERE name = 'expiration' AND CAST(value AS INTEGER) < ?)",
    [now],
  );

  if (filter.ids) addIn("events.id", filter.ids);
  if (filter.authors) addIn("events.pubkey", filter.authors);
  if (filter.kinds) addIn("events.kind", filter.kinds);
  if (filter.since !== undefined) add("events.created_at >= ?", [filter.since]);
  if (filter.until !== undefined) add("events.created_at <= ?", [filter.until]);

  if (filter.search) {
    add("events.id IN (SELECT id FROM events_fts WHERE events_fts MATCH ?)", [filter.search]);
  }

  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#") && Array.isArray(values) && values.length > 0) {
      const tagNameIndex = params.length + 1;
      params.push(key.slice(1));
      const placeholders = values.map((_, idx) => `$${params.length + idx + 1}`).join(", ");
      params.push(...values);
      clauses.push(
        `events.id IN (SELECT event_id FROM tags WHERE name = $${tagNameIndex} AND value IN (${placeholders}))`,
      );
    }
  }

  return {
    clause: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function saveEvent(event: Event) {
  await db.begin(async (tx) => {
    if (isReplaceable(event.kind)) {
      const existingRows = await tx<ExistingRow[]>`
        SELECT id, created_at
        FROM events
        WHERE kind = ${event.kind} AND pubkey = ${event.pubkey}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `;
      const existing = existingRows[0];
      if (existing) {
        if (
          event.created_at < existing.created_at ||
          (event.created_at === existing.created_at && event.id > existing.id)
        ) {
          return;
        }
        await tx`DELETE FROM events WHERE id = ${existing.id}`;
      }
    } else if (isAddressable(event.kind)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
      const existingRows = await tx<ExistingRow[]>`
        SELECT id, created_at
        FROM events
        WHERE kind = ${event.kind}
          AND pubkey = ${event.pubkey}
          AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ${dTag})
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `;
      const existing = existingRows[0];
      if (existing) {
        if (
          event.created_at < existing.created_at ||
          (event.created_at === existing.created_at && event.id > existing.id)
        ) {
          return;
        }
        await tx`DELETE FROM events WHERE id = ${existing.id}`;
      }
    }

    await tx`
      INSERT INTO events (id, pubkey, created_at, kind, content, sig)
      VALUES (
        ${event.id},
        ${event.pubkey},
        ${event.created_at},
        ${event.kind},
        ${event.content},
        ${event.sig}
      )
      ON CONFLICT DO NOTHING
    `;

    const tagRows = event.tags
      .filter((tag) => tag[0] !== undefined && tag[1] !== undefined)
      .map((tag) => ({
        event_id: event.id,
        name: tag[0] as string,
        value: tag[1] as string,
      }));

    if (tagRows.length > 0) {
      await tx`INSERT INTO tags ${tx(tagRows)}`;
    }
  });
}

export async function deleteEvents(
  pubkey: string,
  eventIds: string[],
  identifiers: string[] = [],
  until: number = Infinity,
) {
  await db.begin(async (tx) => {
    // Delete by event IDs (e tags)
    if (eventIds.length > 0) {
      await tx`
        DELETE FROM events
        WHERE pubkey = ${pubkey}
          AND id IN ${tx(eventIds)}
      `;
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
      await tx`
        DELETE FROM events
        WHERE kind = ${kind}
          AND pubkey = ${pubkey}
          AND created_at <= ${until}
          AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ${dTag})
      `;
    }
  });
}

export async function cleanupExpiredEvents() {
  const now = Math.floor(Date.now() / 1000);
  await db.begin(async (tx) => {
    await tx`
      DELETE FROM events
      WHERE id IN (
        SELECT event_id
        FROM tags
        WHERE name = 'expiration'
          AND CAST(value AS INTEGER) < ${now}
      )
    `;
  });
}

export async function countEvents(filters: Filter[]): Promise<number> {
  let totalCount = 0;
  for (const filter of filters) {
    const { clause, params } = buildWhereClause(filter);
    const query = `SELECT COUNT(*) as count FROM events ${clause}`;
    const result = await db.unsafe<{ count: number }[]>(query, params);
    totalCount += result[0]?.count ?? 0;
  }
  return totalCount;
}

export async function queryEvents(filter: Filter): Promise<Event[]> {
  const { clause, params } = buildWhereClause(filter);
  let query = `SELECT id, pubkey, created_at, kind, content, sig FROM events ${clause} ORDER BY created_at DESC`;
  if (filter.limit !== undefined) {
    query += ` LIMIT $${params.length + 1}`;
    params.push(filter.limit);
  }

  const rows = await db.unsafe<EventRow[]>(query, params);
  if (rows.length === 0) return [];

  const eventIds = rows.map((row) => row.id);
  const placeholders = eventIds.map((_, idx) => `$${idx + 1}`).join(", ");
  const tagRows = await db.unsafe<TagRow[]>(
    `SELECT event_id, name, value FROM tags WHERE event_id IN (${placeholders})`,
    eventIds,
  );

  const tagsByEvent = new Map<string, [string, string][]>();
  for (const tag of tagRows) {
    const list = tagsByEvent.get(tag.event_id) ?? [];
    list.push([tag.name, tag.value]);
    tagsByEvent.set(tag.event_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    content: row.content,
    sig: row.sig,
    tags: tagsByEvent.get(row.id) ?? [],
  }));
}
