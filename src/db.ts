import type { Event, Filter } from "nostr-tools";
import { isAddressable, isReplaceable } from "./protocol.ts";
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

type EventWithTagRow = EventRow & {
  tag_name: string | null;
  tag_value: string | null;
};

class WhereBuilder {
  private clauses: string[] = [];
  private params: unknown[] = [];

  add(clause: string, values: readonly unknown[] = []) {
    let built = clause;
    for (const value of values) {
      const placeholder = `$${this.params.length + 1}`;
      built = built.replace("?", placeholder);
      this.params.push(value);
    }
    this.clauses.push(built);
  }

  addIn(column: string, values?: readonly unknown[]) {
    if (!values || values.length === 0) return;
    const placeholders = values.map((_, idx) => `$${this.params.length + idx + 1}`).join(", ");
    this.params.push(...values);
    this.clauses.push(`${column} IN (${placeholders})`);
  }

  addTagFilter(tagName: string, values: readonly string[]) {
    const tagNameIndex = this.params.length + 1;
    this.params.push(tagName);
    const placeholders = values.map((_, idx) => `$${this.params.length + idx + 1}`).join(", ");
    this.params.push(...values);
    this.clauses.push(
      `events.id IN (SELECT event_id FROM tags WHERE name = $${tagNameIndex} AND value IN (${placeholders}))`,
    );
  }

  build() {
    return {
      clause: this.clauses.length > 0 ? `WHERE ${this.clauses.join(" AND ")}` : "",
      params: this.params,
    };
  }
}

function buildWhereClause(filter: Filter) {
  const builder = new WhereBuilder();
  const now = Math.floor(Date.now() / 1000);

  builder.add(
    "events.id NOT IN (SELECT event_id FROM tags WHERE name = 'expiration' AND CAST(value AS INTEGER) < ?)",
    [now],
  );
  builder.addIn("events.id", filter.ids);
  builder.addIn("events.pubkey", filter.authors);
  builder.addIn("events.kind", filter.kinds);

  if (filter.since !== undefined) builder.add("events.created_at >= ?", [filter.since]);
  if (filter.until !== undefined) builder.add("events.created_at <= ?", [filter.until]);

  if (filter.search) {
    builder.add("events.id IN (SELECT id FROM events_fts WHERE events_fts MATCH ?)", [filter.search]);
  }

  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#") && Array.isArray(values) && values.length > 0) {
      builder.addTagFilter(key.slice(1), values as string[]);
    }
  }

  return builder.build();
}

function isOlderEvent(candidate: Event, existing: ExistingRow) {
  return (
    candidate.created_at < existing.created_at ||
    (candidate.created_at === existing.created_at && candidate.id > existing.id)
  );
}

async function findReplaceableEvent(tx: typeof db, event: Event) {
  const rows = await tx<ExistingRow[]>`
    SELECT id, created_at
    FROM events
    WHERE kind = ${event.kind} AND pubkey = ${event.pubkey}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  return rows[0];
}

async function findAddressableEvent(tx: typeof db, event: Event, dTag: string) {
  const rows = await tx<ExistingRow[]>`
    SELECT id, created_at
    FROM events
    WHERE kind = ${event.kind}
      AND pubkey = ${event.pubkey}
      AND id IN (SELECT event_id FROM tags WHERE name = 'd' AND value = ${dTag})
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `;
  return rows[0];
}

function buildTagRows(event: Event): TagRow[] {
  return event.tags
    .filter((tag) => tag[0] !== undefined && tag[1] !== undefined)
    .map((tag) => ({
      event_id: event.id,
      name: tag[0] as string,
      value: tag[1] as string,
    }));
}

async function insertTags(tx: typeof db, event: Event) {
  const tagRows = buildTagRows(event);
  if (tagRows.length === 0) return;
  await tx`INSERT INTO tags ${tx(tagRows)}`;
}

export async function saveEvent(event: Event) {
  await db.begin(async (tx) => {
    if (isReplaceable(event.kind)) {
      const existing = await findReplaceableEvent(tx, event);
      if (existing && isOlderEvent(event, existing)) return;
      if (existing) await tx`DELETE FROM events WHERE id = ${existing.id}`;
    } else if (isAddressable(event.kind)) {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] || "";
      const existing = await findAddressableEvent(tx, event, dTag);
      if (existing && isOlderEvent(event, existing)) return;
      if (existing) await tx`DELETE FROM events WHERE id = ${existing.id}`;
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

    await insertTags(tx, event);
  });
}

export async function deleteEvents(
  pubkey: string,
  eventIds: string[],
  identifiers: string[] = [],
  until: number = Infinity,
) {
  await db.begin(async (tx) => {
    if (eventIds.length > 0) {
      await tx`
        DELETE FROM events
        WHERE pubkey = ${pubkey}
          AND id IN ${tx(eventIds)}
      `;
    }

    for (const addr of identifiers) {
      const parts = addr.split(":");
      if (parts.length < 3) continue;
      const kind = parseInt(parts[0]!);
      const pk = parts[1]!;
      const dTag = parts[2]!;

      if (pk !== pubkey) continue;

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

  const rows = await db.unsafe<EventWithTagRow[]>(query, params);
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
