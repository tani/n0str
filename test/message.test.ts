import { expect, test, describe, beforeAll, beforeEach } from "bun:test";
import { engines } from "./utils/engines.ts";
import { initRepository, getRepository } from "../src/repository.ts";
import { NostrMessageHandler } from "../src/message.ts";
import { WebSocketManager } from "../src/websocket.ts";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

describe.each(engines)("Engine: %s > message handling", () => {
  let handler: NostrMessageHandler;
  let wsManager: WebSocketManager;
  let sk = generateSecretKey();

  beforeAll(async () => {
    await initRepository(":memory:");
    wsManager = new WebSocketManager();
    handler = new NostrMessageHandler(getRepository(), wsManager);
  });

  let sent: any[] = [];
  const mockWs = {
    send: (msg: string) => sent.push(JSON.parse(msg)),
    data: {
      subscriptions: new Map(),
      negSubscriptions: new Map(),
    },
    remoteAddress: "127.0.0.1",
  } as any;

  beforeEach(() => {
    sent = [];
    mockWs.data.pubkey = undefined;
    mockWs.data.challenge = undefined;
    mockWs.data.subscriptions.clear();
    mockWs.data.negSubscriptions.clear();
  });

  test("handleMessage EVENT", async () => {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "hello",
      },
      sk,
    );

    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", event]));
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("OK");
    expect(sent[0][1]).toBe(event.id);
    expect(sent[0][2]).toBe(true);
  });

  test("handleMessage REQ and CLOSE", async () => {
    const subId = "sub1";
    await handler.handleMessage(mockWs, JSON.stringify(["REQ", subId, { kinds: [1] }]));

    // Should have sent EOSE at least
    expect(sent.some((m) => m[0] === "EOSE")).toBe(true);
    expect(mockWs.data.subscriptions.has(subId)).toBe(true);

    await handler.handleMessage(mockWs, JSON.stringify(["CLOSE", subId]));
    expect(mockWs.data.subscriptions.has(subId)).toBe(false);
  });

  test("handleMessage malformed json", async () => {
    await handler.handleMessage(mockWs, "not json");
    expect(sent).toHaveLength(0); // Should just log and return
  });

  test("handleMessage too large", async () => {
    const largeMessage = "A".repeat(1024 * 1024); // 1MB
    await handler.handleMessage(mockWs, largeMessage);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("NOTICE");
    expect(sent[0][1]).toContain("too large");
  });

  test("handleMessage COUNT", async () => {
    await handler.handleMessage(mockWs, JSON.stringify(["COUNT", "c1", { kinds: [1] }]));
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("COUNT");
    expect(sent[0][1]).toBe("c1");
    expect(sent[0][2].count).toBeDefined();
  });

  test("handleMessage AUTH", async () => {
    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", "ws://localhost"],
          ["challenge", "ch1"],
        ],
        content: "",
      },
      sk,
    );

    // We need to set a challenge on the ws data
    mockWs.data.challenge = "ch1";
    mockWs.data.relayUrl = "ws://localhost";

    await handler.handleMessage(mockWs, JSON.stringify(["AUTH", authEvent]));
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("OK");
    expect(sent[0][2]).toBe(true);
  });

  test("handleMessage NEG-OPEN / NEG-MSG / NEG-CLOSE", async () => {
    // Small dummy negentropy initiate message (valid hex)
    const initMsg = "000000";
    const subId = "n1";

    await handler.handleMessage(
      mockWs,
      JSON.stringify(["NEG-OPEN", subId, { kinds: [1] }, initMsg]),
    );
    // Should have sent a NEG-MSG back or NEG-ERR
    expect(sent.some((m) => m[0] === "NEG-MSG" || m[0] === "NEG-ERR")).toBe(true);

    if (mockWs.data.negSubscriptions.has(subId)) {
      await handler.handleMessage(mockWs, JSON.stringify(["NEG-MSG", subId, initMsg]));
      await handler.handleMessage(mockWs, JSON.stringify(["NEG-CLOSE", subId]));
      expect(mockWs.data.negSubscriptions.has(subId)).toBe(false);
    }
  });

  test("handleNegOpen with empty outputMessage branch", async () => {
    const subId = "n2";
    const initMsg = "000000";

    // Mock Negentropy to return empty outputMessage
    const { Negentropy } = await import("../src/negentropy.js");
    const originalReconcile = Negentropy.prototype.reconcile;
    Negentropy.prototype.reconcile = async () => [null, [], []];

    try {
      await handler.handleMessage(
        mockWs,
        JSON.stringify(["NEG-OPEN", subId, { kinds: [1] }, initMsg]),
      );
      expect(sent.some((m) => m[0] === "NEG-MSG" && m[2] === "")).toBe(true);
    } finally {
      Negentropy.prototype.reconcile = originalReconcile;
    }
  });

  test("handleMessage unknown type", async () => {
    await handler.handleMessage(mockWs, JSON.stringify(["UNKNOWN", "stuff"]));
    // Just logs, default branch unreachable but handled defensively
  });

  test("handleMessage expired on publish", async () => {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["expiration", (Math.floor(Date.now() / 1000) - 10).toString()]],
        content: "expired",
      },
      sk,
    );

    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", event]));
    expect(sent).toHaveLength(1);
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("expired");
  });

  test("handleMessage protected event (auth required)", async () => {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["-"]],
        content: "protected",
      },
      sk,
    );

    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", event]));
    expect(sent).toHaveLength(2);
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("auth-required");
    expect(sent[1][0]).toBe("AUTH");
  });

  test("handleMessage protected event (pubkey mismatch)", async () => {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["-"]],
        content: "protected",
      },
      sk,
    );

    const otherSk = generateSecretKey();
    const otherPk = getPublicKey(otherSk);
    mockWs.data.pubkey = otherPk;

    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", event]));
    expect(sent).toHaveLength(1);
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("restricted");

    mockWs.data.pubkey = undefined; // clean up
  });

  test("handleMessage max subscriptions", async () => {
    for (let i = 0; i < 20; i++) {
      mockWs.data.subscriptions.set(`sub${i}`, { filters: [] });
    }

    await handler.handleMessage(mockWs, JSON.stringify(["REQ", "too-many", {}]));
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("CLOSED");
    expect(sent[0][2]).toContain("max subscriptions");

    mockWs.data.subscriptions.clear(); // clean up
  });

  test("handleMessage EVENT kind 5 (delete)", async () => {
    const event = finalizeEvent(
      {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", "deleted-id"],
          ["a", "1:pub1:d"],
        ],
        content: "",
      },
      sk,
    );

    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", event]));
    expect(sent).toHaveLength(1);
    expect(sent[0][2]).toBe(true);
  });
});
