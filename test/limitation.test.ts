import { expect, test, describe, beforeAll, beforeEach } from "bun:test";
import { engines } from "./utils/engines.ts";
import { initRepository, getRepository } from "../src/repository.ts";
import { NostrMessageHandler } from "../src/message.ts";
import { WebSocketManager } from "../src/websocket.ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { relayInfo } from "../src/config.ts";

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
    for (let i = 0; i < maxLimit + 5; i++) {
      const event = finalizeEvent({ kind: 1, created_at: i, tags: [], content: `e${i}` }, sk);
      await getRepository().saveEvent(event);
    }

    sent = [];
    await handler.handleMessage(
      mockWs,
      JSON.stringify(["REQ", "check-limit", { limit: maxLimit + 10 }]),
    );

    const events = sent.filter((m) => m[0] === "EVENT");
    expect(events.length).toBeLessThanOrEqual(maxLimit);
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
});
