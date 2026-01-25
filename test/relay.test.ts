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
import { db } from "../src/db.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { unlinkSync, existsSync } from "fs";
import { sql } from "drizzle-orm";

describe("Relay Integration", () => {
  const dbPath = "nostra.relay.test.db";
  let server: any;
  let url: string;

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    // Clear the database tables before each test
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

  test("EVENT and REQ flow", async () => {
    const ws = new WebSocket(url);

    await new Promise((resolve) => (ws.onopen = resolve));

    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "test message",
      },
      sk,
    );

    // Send EVENT
    ws.send(JSON.stringify(["EVENT", event]));

    const okResponse = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => resolve(JSON.parse(e.data));
    });
    expect(okResponse).toEqual(["OK", event.id, true, ""]);

    // Send REQ
    const subId = "test-sub";
    ws.send(JSON.stringify(["REQ", subId, { authors: [pk] }]));

    const eventResponse = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => resolve(JSON.parse(e.data));
    });
    expect(eventResponse[0]).toBe("EVENT");
    expect(eventResponse[1]).toBe(subId);
    expect(eventResponse[2].id).toBe(event.id);

    const eoseResponse = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => resolve(JSON.parse(e.data));
    });
    expect(eoseResponse).toEqual(["EOSE", subId]);

    ws.close();
  });

  test("Broadcast flow", async () => {
    const ws1 = new WebSocket(url);
    const ws2 = new WebSocket(url);

    await Promise.all([
      new Promise((resolve) => (ws1.onopen = resolve)),
      new Promise((resolve) => (ws2.onopen = resolve)),
    ]);

    const subId = "sub2";
    ws2.send(JSON.stringify(["REQ", subId, { kinds: [1] }]));

    // Wait for EOSE from ws2
    await new Promise(
      (resolve) =>
        (ws2.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg[0] === "EOSE") resolve(msg);
        }),
    );

    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "broadcast test",
      },
      sk,
    );

    ws1.send(JSON.stringify(["EVENT", event]));

    const broadcast = await new Promise<any>((resolve) => {
      ws2.onmessage = (e) => resolve(JSON.parse(e.data));
    });
    expect(broadcast[0]).toBe("EVENT");
    expect(broadcast[1]).toBe(subId);
    expect(broadcast[2].id).toBe(event.id);

    ws1.close();
    ws2.close();
  });

  test("NIP-11 Information Document", async () => {
    const res = await fetch(url.replace("ws://", "http://"), {
      headers: { Accept: "application/nostr+json" },
    });
    expect(res.status).toBe(200);
    const info = (await res.json()) as any;
    expect(info.name).toBe("Nostra Relay");
    expect(info.supported_nips).toContain(11);
  });

  test("Default HTTP Response", async () => {
    const res = await fetch(url.replace("ws://", "http://"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Nostra Relay");
  });

  test("Invalid WebSocket Message", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    // Send invalid JSON - should trigger safe return in message handler
    ws.send("not json");

    // Send valid JSON but not a valid Nostr message
    ws.send(JSON.stringify(["INVALID"]));

    // We expect no crash and no response (relay silently ignores)
    await new Promise((resolve) => setTimeout(resolve, 100));

    ws.close();
  });

  test("CLOSE message", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    const subId = "close-sub";
    ws.send(JSON.stringify(["REQ", subId, {}]));
    await new Promise(
      (resolve) =>
        (ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "EOSE") resolve(null);
        }),
    );

    ws.send(JSON.stringify(["CLOSE", subId]));
    // No response expected, just verifying it doesn't crash and line is hit
    await new Promise((resolve) => setTimeout(resolve, 50));
    ws.close();
  });

  test("Invalid EVENT response", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "original",
      },
      sk,
    );

    // Tamper with content to invalidate signature
    const tamperedEvent = { ...event, content: "tampered" };

    ws.send(JSON.stringify(["EVENT", tamperedEvent]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => resolve(JSON.parse(e.data));
    });
    expect(response[0]).toBe("OK");
    expect(response[2]).toBe(false);
    expect(response[3]).toContain("signature verification failed");

    ws.close();
  });
});
