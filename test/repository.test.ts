import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { SqliteEventRepository } from "../src/repositories/sqlite.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import type { Event } from "nostr-tools";
import { existsSync, unlinkSync } from "fs";

describe("Database", () => {
  const dbPath = "n0str.test.db";
  let repository: SqliteEventRepository;

  beforeEach(async () => {
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch (e) {
        // ignore if busy, might handle it by clearing tables instead?
        // But we don't have direct access to db here easily unless we expose it.
        // Let's assume for now it works or try to proceed.
      }
    }
    repository = new SqliteEventRepository(dbPath);
    await repository.init();

    // Ensure tables are empty if file persisted
    // Since we don't expose raw DB, and unlink might fail on Windows/Busy,
    // we might want a 'clear' method for testing, but let's try assuming a fresh DB first.
    // Actually, if we can't unlink, we are in trouble.
  });

  afterEach(() => {
    // We can't easily close the connection with the SQL adapter wrapper in Bun currently?
  });

  const sampleEvent: Event = {
    id: "1",
    pubkey: "pub1",
    created_at: 1000,
    kind: 1,
    content: "hello",
    sig: "sig1",
    tags: [
      ["p", "target1"],
      ["t", "tag1"],
    ],
  };

  test("saveEvent and queryEvents", async () => {
    await repository.saveEvent(sampleEvent);
    const results = await repository.queryEvents({ authors: ["pub1"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("1");
    expect(results[0]!.tags).toEqual([
      ["p", "target1"],
      ["t", "tag1"],
    ]);
  });

  test("queryEvents with filters", async () => {
    await repository.saveEvent(sampleEvent);
    await repository.saveEvent({
      ...sampleEvent,
      id: "2",
      created_at: 2000,
      kind: 2,
      tags: [["p", "target2"]],
    });

    // Authors filter
    expect(await repository.queryEvents({ authors: ["pub1"] })).toHaveLength(2);

    // Kinds filter
    const kind1 = await repository.queryEvents({ kinds: [1] });
    expect(kind1).toHaveLength(1);
    expect(kind1[0]!.id).toBe("1");

    // Tag filter
    const target1 = await repository.queryEvents({ "#p": ["target1"] });
    expect(target1).toHaveLength(1);
    expect(target1[0]!.id).toBe("1");
    const target2 = await repository.queryEvents({ "#p": ["target2"] });
    expect(target2).toHaveLength(1);
    expect(target2[0]!.id).toBe("2");

    // Since filter
    const since1500 = await repository.queryEvents({ since: 1500 });
    expect(since1500).toHaveLength(1);
    expect(since1500[0]!.id).toBe("2");

    // Until filter
    const until1500 = await repository.queryEvents({ until: 1500 });
    expect(until1500).toHaveLength(1);
    expect(until1500[0]!.id).toBe("1");
  });

  test("queryEvents respects limit", async () => {
    await repository.saveEvent(sampleEvent);
    await repository.saveEvent({
      ...sampleEvent,
      id: "2",
      created_at: 2000,
      kind: 2,
    });
    const limited = await repository.queryEvents({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]!.id).toBe("2");
  });

  test("duplicate save ignored", async () => {
    await repository.saveEvent(sampleEvent);
    await repository.saveEvent(sampleEvent);
    expect(await repository.queryEvents({})).toHaveLength(1);
  });

  test("Ignore older addressable event", async () => {
    const sk = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);

    // 1. Save a new event
    const eventNew = finalizeEvent(
      {
        kind: 30000,
        created_at: now,
        tags: [["d", "test"]],
        content: "new",
      },
      sk,
    );
    await repository.saveEvent(eventNew);

    // 2. Try to save an older event
    const eventOld = finalizeEvent(
      {
        kind: 30000,
        created_at: now - 10,
        tags: [["d", "test"]],
        content: "old",
      },
      sk,
    );
    await repository.saveEvent(eventOld);

    // 3. Verify only the newer one exists
    const stored = await repository.queryEvents({ kinds: [30000] });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(eventNew.id);
  });

  test("cleanupExpiredEvents works", async () => {
    const sk = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);

    // 1. Insert an expired event manually
    const eventExpired = finalizeEvent(
      {
        kind: 1,
        created_at: now - 100,
        tags: [["expiration", (now - 50).toString()]],
        content: "expired",
      },
      sk,
    );
    await repository.saveEvent(eventExpired);

    // 2. Insert a valid event
    const eventValid = finalizeEvent(
      {
        kind: 1,
        created_at: now,
        tags: [["expiration", (now + 50).toString()]],
        content: "valid",
      },
      sk,
    );
    await repository.saveEvent(eventValid);

    // 3. Run cleanup
    await repository.cleanupExpiredEvents();

    // 4. Verify original event is gone but valid remains
    const stored = await repository.queryEvents({ kinds: [1] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(eventValid.id);
  });
});
