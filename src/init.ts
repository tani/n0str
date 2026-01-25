import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

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
