import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/server.ts";
import { db, queryEvents } from "../src/repository.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-05: Identifying users", () => {
  const dbPath = "n0str.nip05.test.db";
  let server: any;
  let url: string;

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    await db`DELETE FROM events`;
    await db`DELETE FROM tags`;
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  test("Kind 0 metadata with nip05 is stored and follows replacement logic", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);

    // 1. Publish metadata
    const event1 = finalizeEvent(
      {
        kind: 0,
        created_at: now,
        tags: [],
        content: JSON.stringify({ name: "bob", nip05: "bob@example.com" }),
      },
      sk,
    );

    ws.send(JSON.stringify(["EVENT", event1]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 2. Publish updated metadata
    const event2 = finalizeEvent(
      {
        kind: 0,
        created_at: now + 1,
        tags: [],
        content: JSON.stringify({ name: "bob", nip05: "bob@newdomain.com" }),
      },
      sk,
    );

    ws.send(JSON.stringify(["EVENT", event2]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 3. Verify only the newer one is stored
    const stored = await queryEvents({ kinds: [0], authors: [pk] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(event2.id);
    const content = JSON.parse(stored[0]?.content || "{}");
    expect(content.nip05).toBe("bob@newdomain.com");

    ws.close();
  });
});
