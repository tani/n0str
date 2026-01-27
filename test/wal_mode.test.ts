import { describe, test, expect, afterAll } from "bun:test";
import { SqliteEventRepository } from "../src/sqlite.ts";
import { unlink } from "node:fs/promises";

describe("SQLite WAL Mode", () => {
  const dbPath = `test-wal-${Date.now()}.sqlite`;
  let repo: SqliteEventRepository;

  afterAll(async () => {
    if (repo) {
      await repo.close();
    }
    try {
      await unlink(dbPath);
      await unlink(`${dbPath}-shm`).catch(() => {});
      await unlink(`${dbPath}-wal`).catch(() => {});
    } catch {
      // ignore
    }
  });

  test("should be in WAL mode after init", async () => {
    repo = new SqliteEventRepository(dbPath);
    await repo.init();

    const result = await repo.db`PRAGMA journal_mode`;
    const mode = result[0]?.journal_mode;

    console.log("Current journal mode:", mode);
    expect(mode).toBe("wal");
  });
});
