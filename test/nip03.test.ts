import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/server.ts";
import { db } from "../src/repository.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-03: OpenTimestamps Attestations", () => {
  const dbPath = "n0str.nip03.test.db";
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

  test("Kind 1040 events are stored and searchable", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const targetEventId = "e".repeat(64);
    const otsEvent = finalizeEvent(
      {
        kind: 1040,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", targetEventId],
          ["k", "1"],
        ],
        content: "YmFzZTY0LWVuY29kZWQgb3RzIGZpbGUgZGF0YQ==", // "base64-encoded ots file data"
      },
      sk,
    );

    ws.send(JSON.stringify(["EVENT", otsEvent]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // Verify it's stored and searchable by the 'e' tag
    ws.send(JSON.stringify(["REQ", "sub1", { "#e": [targetEventId] }]));
    const msg = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data[0] === "EVENT") resolve(data);
      };
    });
    expect(msg[2].id).toBe(otsEvent.id);
    expect(msg[2].content).toBe(otsEvent.content);

    ws.close();
  });
});
