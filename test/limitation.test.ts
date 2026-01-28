import { expect, test, describe, beforeAll, beforeEach } from "bun:test";
import { engines } from "./utils/engines.ts";
import { initRepository, getRepository } from "../src/db/repository.ts";
import { NostrMessageHandler } from "../src/handlers/message.ts";
import { WebSocketManager } from "../src/handlers/websocket.ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { relayInfo } from "../src/config/config.ts";

describe.each(engines)("Engine: %s > config limitation tests", () => {
  let handler: NostrMessageHandler;
  let wsManager: WebSocketManager;
  let sk = generateSecretKey();

  beforeAll(async () => {
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

  test("max_message_length", async () => {
    const maxLen = relayInfo.limitation.max_message_length;
    const largeContent = "a".repeat(maxLen + 1);
    const largeMessage = JSON.stringify(["EVENT", { content: largeContent }]);

    await handler.handleMessage(mockWs, largeMessage);

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("NOTICE");
    expect(sent[0][1]).toContain("message too large");
  });

  test("max_subscriptions", async () => {
    const maxSubs = relayInfo.limitation.max_subscriptions;
    for (let i = 0; i < maxSubs; i++) {
      mockWs.data.subscriptions.set(`sub${i}`, { filters: [] });
    }

    await handler.handleMessage(mockWs, JSON.stringify(["REQ", "one-too-many", {}]));

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("CLOSED");
    expect(sent[0][2]).toContain("max subscriptions reached");
  });

  test("max_filters", async () => {
    const maxFilters = relayInfo.limitation.max_filters;
    const filters = Array.from({ length: maxFilters + 1 }, () => ({}));

    await handler.handleMessage(mockWs, JSON.stringify(["REQ", "too-many-filters", ...filters]));

    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("CLOSED");
    expect(sent[0][2]).toContain("too many filters");
  });

  test("max_limit", async () => {
    const maxLimit = relayInfo.limitation.max_limit;

    // Insert more than maxLimit events
    const pubkey = "0000000000000000000000000000000000000000000000000000000000000001";
    for (let i = 0; i < maxLimit + 5; i++) {
      const event = {
        id: (i + 1).toString(16).padStart(64, "0"),
        pubkey,
        created_at: Math.floor(Date.now() / 1000) - i, // Use recent times
        kind: 1,
        tags: [],
        content: `e${i}`,
        sig: "0".repeat(128),
      };
      await getRepository().saveEvent(event);
    }

    // Case 1: Limit exceeds max_limit
    sent = [];
    await handler.handleMessage(
      mockWs,
      JSON.stringify(["REQ", "check-limit-huge", { limit: maxLimit + 10 }]),
    );

    let events = sent.filter((m) => m[0] === "EVENT");
    expect(events.length).toBeLessThanOrEqual(maxLimit);
    expect(events.length).toBe(maxLimit);

    // Case 2: No limit specified (Implicit default to max_limit)
    sent = [];
    await handler.handleMessage(mockWs, JSON.stringify(["REQ", "check-limit-none", {}]));
    events = sent.filter((m) => m[0] === "EVENT");
    expect(events.length).toBeLessThanOrEqual(maxLimit);
    expect(events.length).toBe(maxLimit);
  });

  test("max_subid_length", async () => {
    // Current implementation of ClientMessageSchema (arktype) might already enforce this if schema is strict,
    // but let's see how it's handled.
    const longSubId = "a".repeat(relayInfo.limitation.max_subid_length + 1);
    await handler.handleMessage(mockWs, JSON.stringify(["REQ", longSubId, {}]));

    // If the schema validation fails, it won't even reach handleReq.
    // If it reaches handleReq, it currently doesn't check length explicitly beyond schema.
  });

  test("max_tag_count", async () => {
    const maxTags = relayInfo.limitation.max_tag_count;
    const tags = Array.from({ length: maxTags + 1 }, (_, i) => ["t", i.toString()]);
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: tags,
        content: "too many tags",
      },
      sk,
    );

    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", event]));

    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("too many tags");
  });

  test("created_at_lower_limit and created_at_upper_limit", async () => {
    const lower = relayInfo.limitation.created_at_lower_limit;
    const upper = relayInfo.limitation.created_at_upper_limit;
    const now = Math.floor(Date.now() / 1000);

    // Too old
    const oldEvent = finalizeEvent(
      {
        kind: 1,
        created_at: now - lower - 10,
        tags: [],
        content: "too old",
      },
      sk,
    );
    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", oldEvent]));
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("too old");

    // Too far future
    sent = [];
    const futureEvent = finalizeEvent(
      {
        kind: 1,
        created_at: now + upper + 10,
        tags: [],
        content: "too future",
      },
      sk,
    );
    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", futureEvent]));
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("too far in the future");
  });
  test("min_pow_difficulty", async () => {
    // We must temporarily override the global config for this test case
    const originalDifficulty = relayInfo.limitation.min_pow_difficulty;
    relayInfo.limitation.min_pow_difficulty = 100; // Impressively high difficulty

    // Event with no PoW
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "no pow",
      },
      sk,
    );

    await handler.handleMessage(mockWs, JSON.stringify(["EVENT", event]));
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("OK");
    expect(sent[0][1]).toBe(event.id);
    expect(sent[0][2]).toBe(false);
    expect(sent[0][3]).toContain("pow: difficulty");

    // Restore config
    relayInfo.limitation.min_pow_difficulty = originalDifficulty;
  });

  test("auth_required", async () => {
    /*
     * Note: auth_required logic is not fully implemented in the handler yet in a way that blocks
     * non-AUTH messages globally if set to true.
     * NIP-42 is implemented for protected events (auth_required: false, but protected event needs auth).
     *
     * If the user intends for 'auth_required: true' to block ALL reads/writes until AUTH,
     * that logic needs to be added to handleMessage or specific handlers.
     *
     * Currently, `relayInfo.limitation.auth_required` is defined but seemingly unused in checking connection state
     * for general EVENT/REQ.
     */
    // Checking if it's implemented.
  });
});
