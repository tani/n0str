import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/relay.ts";
import { db } from "../src/db.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { sql } from "drizzle-orm";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-50 Search Capability", () => {
  const dbPath = "nostra.nip50.test.db";
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
    if (server) server.stop();
  });

  const sk = generateSecretKey();

  test("Search filters events by content", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const msgQueue: any[] = [];
    let resolveMsg: ((val: any) => void) | null = null;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (resolveMsg) {
        resolveMsg(msg);
        resolveMsg = null;
      } else {
        msgQueue.push(msg);
      }
    };

    const nextMsg = () => {
      if (msgQueue.length > 0) return Promise.resolve(msgQueue.shift());
      return new Promise((resolve) => (resolveMsg = resolve));
    };

    // 1. Publish events
    const events = [
      "I love nostr",
      "Bun is fast",
      "SQLite is lightweight",
      "Implementing NIP-50 search",
    ];

    for (const content of events) {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content,
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", event]));
      const ok = await nextMsg();
      expect(ok[0]).toBe("OK");
      expect(ok[2]).toBe(true);
    }

    // 2. Search for "nostr"
    ws.send(JSON.stringify(["REQ", "search1", { search: "nostr" }]));
    let msg = await nextMsg();
    expect(msg[0]).toBe("EVENT");
    expect(msg[2].content).toBe("I love nostr");
    msg = await nextMsg();
    expect(msg[0]).toBe("EOSE");

    // 3. Search for "fast"
    ws.send(JSON.stringify(["REQ", "search2", { search: "fast" }]));
    msg = await nextMsg();
    expect(msg[0]).toBe("EVENT");
    expect(msg[2].content).toBe("Bun is fast");
    msg = await nextMsg();
    expect(msg[0]).toBe("EOSE");

    // 4. Search for something that doesn't exist
    ws.send(JSON.stringify(["REQ", "search3", { search: "missing" }]));
    msg = await nextMsg();
    expect(msg[0]).toBe("EOSE");

    ws.close();
  });
});
