import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createTestEnv } from "../utils/test_helper.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-01 Core Relay", () => {
  let server: any;
  let url: string;
  let repository: any;
  let relayService: any;

  beforeEach(async () => {
    const env = await createTestEnv();
    server = env.server;
    url = env.url;
    repository = env.repository;
    relayService = env.relayService;
  });

  afterEach(async () => {
    server.stop();
    await repository.close();
  });

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  test("EVENT and REQ flow", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "test message",
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

    const subId = "test-sub";
    ws.send(JSON.stringify(["REQ", subId, { authors: [pk] }]));

    const eventResponse = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "EVENT") resolve(msg);
      };
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

  test("Invalid WebSocket Message", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    ws.send("not json");
    ws.send(JSON.stringify(["INVALID"]));
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

    const tamperedEvent = { ...event, content: "tampered" };
    ws.send(JSON.stringify(["EVENT", tamperedEvent]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(msg);
      };
    });
    expect(response[0]).toBe("OK");
    expect(response[2]).toBe(false);
    expect(response[3]).toContain("signature verification failed");

    ws.close();
  });

  test("Upgrade failed branch", async () => {
    // We fake a server where upgrade returns false
    const fakeServer = { upgrade: () => false };
    const req = new Request("http://localhost", {
      headers: { Upgrade: "websocket" },
    });
    // Use the local relayService instance instead of global relay
    const res = relayService.fetch(req, fakeServer);
    expect(res?.status).toBe(400);
    expect(await res?.text()).toBe("Upgrade failed");
  });

  test("NIP-12: Generic Tag Queries (#e, #p, etc.)", async () => {
    const ws = new WebSocket(url);

    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", "some-event-id"],
          ["p", "some-pubkey"],
          ["t", "nostr"],
        ],
        content: "NIP-12 test",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", event]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // Test multiple tag filters
    const subId = "nip12-sub";
    ws.send(JSON.stringify(["REQ", subId, { "#t": ["nostr"], "#p": ["some-pubkey"] }]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "EVENT") resolve(msg);
      };
    });
    expect(response[2].id).toBe(event.id);

    ws.close();
  });
});
