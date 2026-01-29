import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { SqliteEventRepository } from "../src/db/sqlite.ts";
import { unlink } from "node:fs/promises";

describe("SQLite Database Stress Test", () => {
  const dbPath = `test-stress-${Date.now()}.db`;
  let repo: SqliteEventRepository;

  beforeAll(async () => {
    repo = new SqliteEventRepository(dbPath);
    await repo.init();
  });

  afterAll(async () => {
    await repo.close();
    try {
      await unlink(dbPath);
      await unlink(`${dbPath}-shm`).catch(() => {});
      await unlink(`${dbPath}-wal`).catch(() => {});
    } catch {
      // ignore
    }
  });

  const createDummyEvent = (i: number, tags: string[][] = []) => ({
    id: i.toString(16).padStart(64, "0"),
    pubkey: (i % 100).toString(16).padStart(64, "0"), // 100 different authors
    created_at: Math.floor(Date.now() / 1000) + i,
    kind: 1, // Use regular event for all to avoid replacement in bulk test
    tags: [["t", `stress-test`], ["idx", i.toString()], ...tags],
    content: `Stress test message ${i} with searchable keyword: ${i % 100 === 0 ? "BINGO" : "random"}`,
    sig: "0".repeat(128),
  });

  test("10,000 events bulk insertion", async () => {
    const COUNT = 10000;
    const startTime = Date.now();

    for (let i = 0; i < COUNT; i++) {
      await repo.saveEvent(createDummyEvent(i));
    }

    const duration = Date.now() - startTime;
    console.log(
      `Bulk Insertion: ${COUNT} events in ${duration}ms (${(COUNT / (duration / 1000)).toFixed(2)} events/sec)`,
    );

    const count = await repo.countEvents([{ kinds: [1] }]);
    expect(count).toBe(COUNT);
  }, 60000);

  test("Concurrent search stress", async () => {
    const QUERY_COUNT = 50;
    const startTime = Date.now();

    const tasks = Array.from({ length: QUERY_COUNT }, () => {
      return repo.queryEvents({ search: "BINGO", limit: 100 });
    });

    const results = await Promise.all(tasks.map((t) => Array.fromAsync(t)));
    const duration = Date.now() - startTime;

    console.log(`Search Stress: ${QUERY_COUNT} FTS queries in ${duration}ms`);
    expect(results.length).toBe(QUERY_COUNT);
    expect(results[0]?.length).toBe(100);
  }, 60000);

  test("Concurrent tag query stress", async () => {
    const QUERY_COUNT = 200;
    const startTime = Date.now();

    const tasks = Array.from({ length: QUERY_COUNT }, (_, i) => {
      return Array.fromAsync(
        repo.queryEvents({
          "#idx": [(i * 10).toString()],
          kinds: [1],
        }),
      );
    });

    const results = await Promise.all(tasks);
    const duration = Date.now() - startTime;

    console.log(`Tag Query Stress: ${QUERY_COUNT} queries in ${duration}ms`);
    expect(results.length).toBe(QUERY_COUNT);
  }, 60000);

  test("Mixed read/write load stress", async () => {
    const WRITE_COUNT = 1000;
    const READ_COUNT = 1000;
    const startTime = Date.now();

    const reads = Array.from({ length: READ_COUNT }, () => {
      return Array.fromAsync(repo.queryEvents({ kinds: [1], limit: 10 }));
    });

    const writePromise = (async () => {
      for (let i = 0; i < WRITE_COUNT; i++) {
        await repo.saveEvent(createDummyEvent(20000 + i));
      }
    })();

    await Promise.all([writePromise, ...reads]);

    const duration = Date.now() - startTime;
    console.log(`Mixed load: ${WRITE_COUNT} writes & ${READ_COUNT} reads in ${duration}ms`);
  }, 60000);

  test("Massive deletion stress", async () => {
    const startTime = Date.now();

    // We'll delete 500 events across different authors
    // Group IDs by author for proper deleteEvents calls
    const groupedByIds = new Map<string, string[]>();
    for (let i = 0; i < 500; i++) {
      const i_event = i * 20;
      const pubkey = (i_event % 100).toString(16).padStart(64, "0");
      const id = i_event.toString(16).padStart(64, "0");
      if (!groupedByIds.has(pubkey)) groupedByIds.set(pubkey, []);
      groupedByIds.get(pubkey)!.push(id);
    }

    const idsToDelete: string[] = [];
    for (const [pubkey, ids] of groupedByIds) {
      await repo.deleteEvents(pubkey, ids, []);
      idsToDelete.push(...ids);
    }

    const duration = Date.now() - startTime;
    console.log(`Deletion Stress: ${idsToDelete.length} events deleted in ${duration}ms`);

    const count = await repo.countEvents([{ ids: idsToDelete }]);
    expect(count).toBe(0);
  }, 30000);

  test("Large filter stress (many authors)", async () => {
    const pubkeys = Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(64, "0"));
    const startTime = Date.now();

    const results = await Array.fromAsync(repo.queryEvents({ authors: pubkeys, limit: 100 }));
    const duration = Date.now() - startTime;

    console.log(`Large filter: ${pubkeys.length} authors query in ${duration}ms`);
    expect(results.length).toBeGreaterThan(0);
  });

  test("Replaceable event overwrite stress", async () => {
    const COUNT = 1000;
    const pubkey = "f".repeat(64);
    const startTime = Date.now();

    for (let i = 0; i < COUNT; i++) {
      await repo.saveEvent({
        id: "f".repeat(32) + i.toString(16).padStart(32, "0"),
        pubkey,
        created_at: i,
        kind: 0, // Kind 0 is replaceable
        tags: [],
        content: `version ${i}`,
        sig: "0".repeat(128),
      });
    }

    const duration = Date.now() - startTime;
    console.log(`Replaceable overwrite: ${COUNT} versions in ${duration}ms`);

    const latest = await Array.fromAsync(repo.queryEvents({ authors: [pubkey], kinds: [0] }));
    expect(latest.length).toBe(1);
    expect(latest[0]?.content).toBe(`version ${COUNT - 1}`);
  }, 30000);
});
