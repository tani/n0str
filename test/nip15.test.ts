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

describe("NIP-15: Nostr Marketplace", () => {
  const dbPath = "n0str.nip15.test.db";
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

  test("Marketplace events (Kind 30017) follow addressable replacement logic", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);
    const kind = 30017; // Marketplace Stall

    const e1 = finalizeEvent(
      {
        kind,
        created_at: now,
        tags: [["d", "stall-1"]],
        content: "v1",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", e1]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    const e2 = finalizeEvent(
      {
        kind,
        created_at: now + 1,
        tags: [["d", "stall-1"]],
        content: "v2",
      },
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

    ws.close();
  });
});
