import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { generateSecretKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-44: Encrypted Payloads", () => {
  const dbPath = "nostra.nip44.test.db";
  let server: any;
  let url: string;
  let relay: any;
  let db: any;

  beforeAll(async () => {
    process.env.DATABASE_PATH = dbPath;
    // Dynamic import to ensure env var is set before DB init
    const relayModule = await import("../src/relay.ts");
    relay = relayModule.relay;
    const dbModule = await import("../src/db.ts");
    db = dbModule.db;
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

  test("NIP-44 formatted events (base64 content) are accepted", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    // Dummy NIP-44 payload (base64)
    // From NIP-44 spec test vector:
    const payload =
      "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb";

    const event = finalizeEvent(
      {
        kind: 1, // NIP-44 can be used in kind 1 or others
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: payload,
      },
      sk,
    );

    ws.send(JSON.stringify(["EVENT", event]));

    const okResponse = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(msg);
      };
    });
    expect(okResponse).toEqual(["OK", event.id, true, ""]);

    // Verify it can be retrieved
    const subId = "test-sub";
    ws.send(JSON.stringify(["REQ", subId, { ids: [event.id] }]));

    const eventResponse = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "EVENT") resolve(msg);
      };
    });
    expect(eventResponse[2].id).toBe(event.id);
    expect(eventResponse[2].content).toBe(payload);

    ws.close();
  });
});
