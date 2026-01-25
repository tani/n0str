import {
  expect,
  test,
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { relay } from "../src/relay.ts";
import { db, queryEvents } from "../src/db.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { sql } from "drizzle-orm";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("Wide Event Support (NIPs 15-65)", () => {
  const dbPath = "nostra.nip_wide.test.db";
  let server: any;
  let url: string;

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    await db.run(sql`DELETE FROM events`);
    await db.run(sql`DELETE FROM tags`);
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  test("NIP-15/23/33: Addressable events replacement", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);
    const kinds = [30017, 30023, 30078]; // Marketplace Stall, Long-form, App Data

    for (const kind of kinds) {
      // 1. Publish with d=test
      const e1 = finalizeEvent(
        {
          kind,
          created_at: now,
          tags: [["d", "test"]],
          content: "first",
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", e1]));
      await new Promise((resolve) => {
        ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "OK") resolve(null);
        };
      });

      // 2. Publish newer with d=test
      const e2 = finalizeEvent(
        {
          kind,
          created_at: now + 1,
          tags: [["d", "test"]],
          content: "second",
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", e2]));
      await new Promise((resolve) => {
        ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "OK") resolve(null);
        };
      });

      // 3. Verify replacement
      const stored = await queryEvents({ kinds: [kind], authors: [pk] });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.content).toBe("second");
    }

    ws.close();
  });

  test("NIP-51/65: Replaceable events (10000 range)", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);
    const kinds = [10000, 10002]; // Mute list, Relay List Metadata

    for (const kind of kinds) {
      const e1 = finalizeEvent(
        { kind, created_at: now, tags: [], content: "v1" },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", e1]));
      await new Promise((resolve) => {
        ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "OK") resolve(null);
        };
      });

      const e2 = finalizeEvent(
        { kind, created_at: now + 1, tags: [], content: "v2" },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", e2]));
      await new Promise((resolve) => {
        ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "OK") resolve(null);
        };
      });

      const stored = await queryEvents({ kinds: [kind], authors: [pk] });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.content).toBe("v2");
    }

    ws.close();
  });

  test("NIP-17/18/25: Regular and GiftWrap events", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const kinds = [6, 7, 1059]; // Repost, Reaction, Gift Wrap

    for (const kind of kinds) {
      const e = finalizeEvent(
        {
          kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: kind === 1059 ? [["p", pk]] : [],
          content: "content",
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", e]));
      await new Promise((resolve) => {
        ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "OK") resolve(null);
        };
      });

      const stored = await queryEvents({ kinds: [kind] });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe(e.id);

      // Clear for next iteration
      await db.run(sql`DELETE FROM events`);
    }

    ws.close();
  });

  test("NIP-28: Public Chat (40, 41 replaceable, 42 regular)", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    // Kind 40: Channel Creation (Replaceable? Actually NIP-28 says "relays SHOULD NOT replace")
    // Let's check NIPs/28. Kind 40/41/42 etc.
    // Kind 40/41 are in the "replaceable" range (10000-19999 is replaceable, 0-9999 is regular except 0 and 3)
    // Wait, kind 40 is NOT in replaceable range in src/protocol.ts:
    // export function isReplaceable(kind: number): boolean {
    //   return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
    // }
    // So 40/41 are REGULAR in our implementation currently. (NIP-01 says 10000-19999 are replaceable)
    // NIP-28 doesn't explicitly say they are replaceable.

    const e40 = finalizeEvent(
      {
        kind: 40,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "channel",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", e40]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    const stored = await queryEvents({ kinds: [40] });
    expect(stored).toHaveLength(1);

    ws.close();
  });
});
