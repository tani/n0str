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

describe("NIP-40 Expiration", () => {
  const dbPath = "n0str.nip40.test.db";
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

  test("NIP-40: Expired events are not stored", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: now - 100,
        tags: [["expiration", (now - 50).toString()]],
        content: "already expired",
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
    expect(response[3]).toBe("error: event has expired");

    ws.close();
  });

  test("NIP-40: Expired events are filtered from REQ", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

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

    // 1. Consume AUTH
    const auth = await nextMsg();
    expect(auth[0]).toBe("AUTH");

    const now = Math.floor(Date.now() / 1000);
    const expiredEvent = finalizeEvent(
      {
        kind: 1,
        created_at: now - 100,
        tags: [["expiration", (now - 50).toString()]],
        content: "this is already expired",
      },
      sk,
    );

    // Insert directly to DB to bypass handleEvent's publish-time rejection
    const { saveEvent } = await import("../src/repository.ts");
    await saveEvent(expiredEvent);

    ws.send(JSON.stringify(["REQ", "sub1", {}]));

    const msgs: any[] = [];
    while (true) {
      const msg = await nextMsg();
      msgs.push(msg);
      if (msg[0] === "EOSE") break;
    }

    expect(msgs.some((m) => m[0] === "EVENT")).toBe(false);

    ws.close();
  });
});
