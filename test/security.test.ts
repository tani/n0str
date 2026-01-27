import { expect, test, describe, beforeAll, beforeEach } from "bun:test";
import { engines } from "./utils/engines.ts";
import { initRepository, getRepository } from "../src/repository.ts";
import { NostrMessageHandler } from "../src/message.ts";
import { WebSocketManager } from "../src/websocket.ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";

describe.each(engines)("Engine: %s > security resilience", () => {
  let handler: NostrMessageHandler;
  let wsManager: WebSocketManager;
  let sk = generateSecretKey();

  beforeAll(async () => {
    // Use a fresh file for each engine to avoid interference if needed,
    // but :memory: is fine for these tests usually.
    await initRepository(`:memory:`);
    wsManager = new WebSocketManager();
    handler = new NostrMessageHandler(getRepository(), wsManager);
  });

  let sent: any[] = [];
  const mockWs = {
    send: (msg: string) => sent.push(JSON.parse(msg)),
    data: {
      subscriptions: new Map(),
      negSubscriptions: new Map(),
      challenge: "test-challenge",
      relayUrl: "ws://localhost",
    },
    remoteAddress: "127.0.0.1",
  } as any;

  beforeEach(async () => {
    sent = [];
    mockWs.data.pubkey = undefined;
    mockWs.data.subscriptions.clear();
    mockWs.data.negSubscriptions.clear();
    await getRepository().clear();
  });

  test("REQ with excessive number of filters (Filter Bomb)", async () => {
    const subId = "bomb";
    // Create 1000 small filters.
    // relayInfo.limitation.max_filters is 10.
    const filters = Array.from({ length: 1000 }, () => ({ kinds: [1] }));

    await handler.handleMessage(mockWs, JSON.stringify(["REQ", subId, ...filters]));

    // Check if it's rejected.
    expect(sent.some((m) => m[0] === "CLOSED" && m[2].includes("too many filters"))).toBe(true);
  });

  test("REQ with massive limit (Limit Bomb)", async () => {
    const subId = "limit-bomb";
    // relayInfo.limitation.max_limit is 1000.
    const filter = { kinds: [1], limit: 1000000 };

    // Insert a few events
    for (let i = 0; i < 10; i++) {
      const event = finalizeEvent({ kind: 1, created_at: i, tags: [], content: `e${i}` }, sk);
      await getRepository().saveEvent(event);
    }

    await handler.handleMessage(mockWs, JSON.stringify(["REQ", subId, filter]));

    // Check if it's accepted. We can't easily check if the DB enforced it without many events,
    // but we can check if the code in repository.ts/sqlite.ts uses the provided limit directly.
  });

  test("EVENT with massive number of tags (Tag Bomb)", async () => {
    // Create 1000 tags
    const tags = Array.from({ length: 1000 }, (v, i) => ["t", i.toString()]);
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: "tag bomb",
      },
      sk,
    );

    // This should probably be rejected by max_message_length if it's > 64KB.
    // Let's check the size. 1000 tags of ["t", "100"] is roughly 1000 * 15 bytes = 15KB.
    // So it should pass the length check.

    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", event]));

    // Should be rejected
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("too many tags");
  });

  test("AUTH with mismatching relay URL", async () => {
    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", "ws://malicious-relay.com"],
          ["challenge", "test-challenge"],
        ],
        content: "",
      },
      sk,
    );

    await handler.handleMessage(mockWs, JSON.stringify(["AUTH", authEvent]));

    // Should be rejected
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("relay tag mismatch");
  });

  test("AUTH with old timestamp", async () => {
    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000) - 3601, // 1 hour ago
        tags: [
          ["relay", "ws://localhost"],
          ["challenge", "test-challenge"],
        ],
        content: "",
      },
      sk,
    );

    await handler.handleMessage(mockWs, JSON.stringify(["AUTH", authEvent]));

    // Should be rejected
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("created_at is too far");
  });

  test("Negentropy sync with huge number of events (OOM risk)", async () => {
    const pubkey = "0".repeat(64);
    for (let i = 0; i < 1000; i++) {
      const event = {
        id: i.toString(16).padStart(64, "0"),
        pubkey,
        created_at: i,
        kind: 1,
        tags: [],
        content: `e${i}`,
        sig: "0".repeat(128),
      };
      await getRepository().saveEvent(event);
    }

    const subId = "neg-oom";
    const initMsg = "00010203040506070809";
    await handler.handleMessage(mockWs, JSON.stringify(["NEG-OPEN", subId, {}, initMsg]));

    const hasResponse = sent.some((m) => m[0] === "NEG-MSG" || m[0] === "NEG-ERR");
    if (!hasResponse) {
      console.warn(`[VULNERABILITY] Engine sqlite: NEG-OPEN did not send any response`);
    }
    expect(hasResponse).toBe(true);
  });
});
