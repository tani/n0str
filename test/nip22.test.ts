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

describe("NIP-22: Event Created_at Limits", () => {
  const dbPath = "nostra.nip22.test.db";
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

  test("Reject events too far in the future", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const futureTime = Math.floor(Date.now() / 1000) + 7200; // 2 hours ahead
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: futureTime,
        tags: [],
        content: "I am from the future",
      },
      sk,
    );

    ws.send(JSON.stringify(["EVENT", event]));
    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(msg);
      };
    });

    expect(response[0]).toBe("OK");
    expect(response[2]).toBe(false);
    expect(response[3]).toBe("error: event is too far in the future");

    ws.close();
  });

  test("Reject events too far in the past", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const pastTime = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 400; // > 1 year ago
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: pastTime,
        tags: [],
        content: "I am a fossil",
      },
      sk,
    );

    ws.send(JSON.stringify(["EVENT", event]));
    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(msg);
      };
    });

    expect(response[0]).toBe("OK");
    expect(response[2]).toBe(false);
    expect(response[3]).toBe("error: event is too old");

    ws.close();
  });

  test("Accept events within limits", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "I am timely",
      },
      sk,
    );

    ws.send(JSON.stringify(["EVENT", event]));
    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(msg);
      };
    });

    expect(response[0]).toBe("OK");
    expect(response[2]).toBe(true);

    ws.close();
  });
});
