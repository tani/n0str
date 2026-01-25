import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { saveEvent, queryEvents, db } from "../src/db.ts";
import type { Event } from "nostr-tools";
import { unlinkSync, existsSync } from "fs";
import { sql } from "drizzle-orm";

describe("Database", () => {
  const dbPath = "nostra.test.db";

  beforeEach(async () => {
    process.env.DATABASE_PATH = dbPath;
    // Clear tables using drizzle instance directly for test setup
    await db.run(sql`DELETE FROM events`);
    await db.run(sql`DELETE FROM tags`);
  });

  afterEach(() => {
    if (existsSync(dbPath)) {
      // Note: we can't easily unlink if the singleton 'db' (sqlite) is still holding the file.
      // For tests, we'll just clear the tables in beforeEach.
    }
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
    await saveEvent(sampleEvent);
    const results = await queryEvents({ authors: ["pub1"] });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("1");
    expect(results[0]!.tags).toEqual([
      ["p", "target1"],
      ["t", "tag1"],
    ]);
  });

  test("queryEvents with filters", async () => {
    await saveEvent(sampleEvent);
    await saveEvent({
      ...sampleEvent,
      id: "2",
      created_at: 2000,
      kind: 2,
      tags: [["p", "target2"]],
    });

    // Authors filter
    expect(await queryEvents({ authors: ["pub1"] })).toHaveLength(2);

    // Kinds filter
    const kind1 = await queryEvents({ kinds: [1] });
    expect(kind1).toHaveLength(1);
    expect(kind1[0]!.id).toBe("1");

    // Tag filter
    const target1 = await queryEvents({ "#p": ["target1"] });
    expect(target1).toHaveLength(1);
    expect(target1[0]!.id).toBe("1");
    const target2 = await queryEvents({ "#p": ["target2"] });
    expect(target2).toHaveLength(1);
    expect(target2[0]!.id).toBe("2");

    // Since filter
    const since1500 = await queryEvents({ since: 1500 });
    expect(since1500).toHaveLength(1);
    expect(since1500[0]!.id).toBe("2");

    // Until filter
    const until1500 = await queryEvents({ until: 1500 });
    expect(until1500).toHaveLength(1);
    expect(until1500[0]!.id).toBe("1");
  });

  test("duplicate save ignored", async () => {
    await saveEvent(sampleEvent);
    await saveEvent(sampleEvent);
    expect(await queryEvents({})).toHaveLength(1);
  });
});
