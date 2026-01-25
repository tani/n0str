import { expect, test, describe, beforeAll, beforeEach } from "bun:test";
import { db, saveEvent, queryEvents, cleanupExpiredEvents } from "../src/db.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { sql } from "drizzle-orm";
import { validateAuthEvent } from "../src/protocol.ts";
import { relay } from "../src/relay.ts";

describe("Coverage Booster", () => {
  const dbPath = "nostra.coverage.test.db";

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    await db.run(sql`DELETE FROM events`);
    await db.run(sql`DELETE FROM tags`);
  });

  const sk1 = generateSecretKey();
  const pk1 = getPublicKey(sk1);

  test("db.ts: Ignore older addressable event", async () => {
    const now = Math.floor(Date.now() / 1000);

    // 1. Save a new event
    const eventNew = finalizeEvent(
      {
        kind: 30000,
        created_at: now,
        tags: [["d", "test"]],
        content: "new",
      },
      sk1,
    );
    await saveEvent(eventNew);

    // 2. Try to save an older event
    const eventOld = finalizeEvent(
      {
        kind: 30000,
        created_at: now - 10,
        tags: [["d", "test"]],
        content: "old",
      },
      sk1,
    );
    await saveEvent(eventOld);

    // 3. Verify only the newer one exists
    const stored = await queryEvents({ kinds: [30000] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(eventNew.id);
  });

  test("db.ts: cleanupExpiredEvents works", async () => {
    const now = Math.floor(Date.now() / 1000);

    // 1. Insert an expired event manually
    const eventExpired = finalizeEvent(
      {
        kind: 1,
        created_at: now - 100,
        tags: [["expiration", (now - 50).toString()]],
        content: "expired",
      },
      sk1,
    );
    await saveEvent(eventExpired);

    // 2. Insert a valid event
    const eventValid = finalizeEvent(
      {
        kind: 1,
        created_at: now,
        tags: [["expiration", (now + 50).toString()]],
        content: "valid",
      },
      sk1,
    );
    await saveEvent(eventValid);

    // 3. Run cleanup
    await cleanupExpiredEvents();

    // 4. Verify original event is gone but valid remains
    const stored = await queryEvents({ kinds: [1] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(eventValid.id);
  });

  describe("protocol.ts: validateAuthEvent branches", () => {
    test("invalid signature", () => {
      const event = finalizeEvent(
        {
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "",
        },
        sk1,
      );
      const tampered = { ...event, sig: "0".repeat(128) };
      const res = validateAuthEvent(tampered, "challenge", "ws://localhost");
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("signature verification failed");
    });

    test("wrong kind", () => {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "",
        },
        sk1,
      );
      const res = validateAuthEvent(event, "challenge", "ws://localhost");
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("invalid: kind must be 22242");
    });

    test("created_at too far", () => {
      const event = finalizeEvent(
        {
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000) - 1000,
          tags: [],
          content: "",
        },
        sk1,
      );
      const res = validateAuthEvent(event, "challenge", "ws://localhost");
      expect(res.ok).toBe(false);
      expect(res.reason).toBe(
        "invalid: created_at is too far from current time",
      );
    });

    test("missing relay tag", () => {
      const event = finalizeEvent(
        {
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["challenge", "challenge"]],
          content: "",
        },
        sk1,
      );
      const res = validateAuthEvent(event, "challenge", "ws://localhost");
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("invalid: missing relay tag");
    });
  });

  describe("relay.ts: fetch branches", () => {
    test("Upgrade failed branch", async () => {
      // We fake a server where upgrade returns false
      const fakeServer = { upgrade: () => false };
      const req = new Request("http://localhost", {
        headers: { Upgrade: "websocket" },
      });
      const res = relay.fetch(req, fakeServer);
      expect(res?.status).toBe(400);
      expect(await res?.text()).toBe("Upgrade failed");
    });
  });
});
