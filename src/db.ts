import { SQL } from "bun";

const dbPath = process.env.DATABASE_PATH || "nostra.db";

/**
 * Database instance using Bun's SQL client with SQLite.
 * Initializes the schema and FTS5 search capability on load.
 */
export const db = new SQL({
  adapter: "sqlite",
  filename: dbPath,
});

await db`PRAGMA foreign_keys = ON`;

await db`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    kind INTEGER NOT NULL,
    content TEXT NOT NULL,
    sig TEXT NOT NULL
  );
`;
await db`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
  );
`;
await db`CREATE INDEX IF NOT EXISTS idx_events_pubkey ON events(pubkey);`;
await db`CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);`;
await db`CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);`;
await db`CREATE INDEX IF NOT EXISTS idx_tags_name_value ON tags(name, value);`;

// NIP-50: FTS5 Search Capability (Internal content for reliability)
await db`
  CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
    id,
    content
  );
`;

// Triggers for FTS5 sync
await db`
  CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(id, content) VALUES (new.id, new.content);
  END;
`;

await db`
  CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
    DELETE FROM events_fts WHERE id = old.id;
  END;
`;
