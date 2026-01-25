import type { Event, Filter } from "nostr-tools";
import { isAddressable, isReplaceable } from "./nostr.ts";
import { db } from "./db.ts";

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

type SqlCondition = { sql: string; params: unknown[] };
type FilterCondition = SqlCondition | { col: string; val: unknown; op?: string };

function toSqlCondition(c: FilterCondition): SqlCondition[] {
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

function finalizeConditions(conditions: SqlCondition[]) {
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

function buildWhereClause(filter: Filter) {
  const now = Math.floor(Date.now() / 1000);

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
      params: filter.search ? [filter.search] : [],
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

  return finalizeConditions(rawConditions.flatMap(toSqlCondition));
}

function isOlderEvent(candidate: Event, existing: ExistingRow) {
  return (
    candidate.created_at < existing.created_at ||
    (candidate.created_at === existing.created_at && candidate.id > existing.id)
  );
}

async function findExisting(tx: typeof db, event: Event): Promise<ExistingRow | undefined> {
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

function buildTagRows(event: Event): TagRow[] {
  return event.tags.flatMap(([name, value]) =>
    name && value ? [{ event_id: event.id, name, value }] : [],
  );
}

export async function saveEvent(event: Event) {
  await db.begin(async (tx) => {
    const existing = await findExisting(tx, event);
    if (existing) {
      if (isOlderEvent(event, existing)) return;
      await tx`DELETE FROM events WHERE id = ${existing.id}`;
    }

    await tx`
      INSERT INTO events ${tx(event, "id", "pubkey", "created_at", "kind", "content", "sig")}
      ON CONFLICT DO NOTHING
    `;

    const tagRows = buildTagRows(event);
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
