import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/relay.ts";
import { db } from "../src/db.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-45 Event Counts", () => {
  const dbPath = "nostra.nip45.test.db";
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

  test("NIP-45: COUNT message", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    for (let i = 0; i < 3; i++) {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: `test ${i}`,
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", event]));
      await new Promise((resolve) => {
        ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "OK") resolve(null);
        };
      });
    }

    const subId = "count-sub";
    ws.send(JSON.stringify(["COUNT", subId, { kinds: [1] }]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "COUNT") resolve(msg);
      };
    });

    expect(response[0]).toBe("COUNT");
    expect(response[1]).toBe(subId);
    expect(response[2].count).toBe(3);

    ws.close();
  });
});
