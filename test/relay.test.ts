import { engines } from "./utils/engines.ts";
import { describe, expect, test } from "bun:test";
import { createRepository } from "../src/db/repository.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { relayInfo } from "../src/config/config.ts";
import { NostrRelay } from "../src/services/relay.ts";

describe.each(engines)("Engine: %s > relay coverage", () => {
  test("relay fetch branches and websocket message paths", async () => {
    await using repository = createRepository(":memory:");
    await using relay = new NostrRelay(repository);
    await relay.init();

    const sent: string[] = [];
    const ws = {
      send: (msg: string) => sent.push(msg),
      remoteAddress: "localhost",
      data: {
        subscriptions: new Map<string, any>(),
        challenge: "c",
        relayUrl: "ws://relay",
        negSubscriptions: new Map(),
      },
    } as any;

    relay.websocket.open(ws);

    const upgradeServer = {
      upgrade: () => true,
    };
    const upgradeReq = new Request("http://localhost/", {
      headers: { Upgrade: "websocket" },
    });
    const upgradeResult = await relay.fetch(upgradeReq, upgradeServer);
    expect(upgradeResult).toBeUndefined();

    const failedUpgradeServer = {
      upgrade: () => false,
    };
    const failedResult = (await relay.fetch(upgradeReq, failedUpgradeServer)) as Response;
    expect(failedResult.status).toBe(400);

    const infoReq = new Request("http://localhost/", {
      headers: { Accept: "application/nostr+json" },
    });
    const infoResult = (await relay.fetch(infoReq, failedUpgradeServer)) as Response;
    expect(infoResult.headers.get("Content-Type")).toBe("application/nostr+json");

    const defaultReq = new Request("http://localhost/");
    const defaultResult = (await relay.fetch(defaultReq, failedUpgradeServer)) as Response;
    expect(await defaultResult.text()).toContain("n0str Relay");

    await relay.websocket.message(ws, "not json");

    const sk = generateSecretKey();
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "hello",
      },
      sk,
    );
    await repository.saveEvent(event);

    const welcomeWithEventsReq = new Request("http://localhost/");
    const welcomeWithEventsResult = (await relay.fetch(
      welcomeWithEventsReq,
      failedUpgradeServer,
    )) as Response;
    const html = await welcomeWithEventsResult.text();
    expect(html).toMatch(/<span[^>]*id="total-events"[^>]*>\s*1\s*<\/span>/);

    const closeSubId = "sub-close";
    ws.data.subscriptions.set(closeSubId, {
      filters: [],
      subIdJson: JSON.stringify(closeSubId),
      abortController: new AbortController(),
    });
    await relay.websocket.message(ws, JSON.stringify(["CLOSE", closeSubId]));
    expect(ws.data.subscriptions.has(closeSubId)).toBe(false);

    await relay.websocket.message(ws, "x".repeat(relayInfo.limitation.max_message_length + 1));
    expect(sent[sent.length - 1]).toContain("error: message too large");

    await relay.websocket.message(ws, JSON.stringify(["COUNT", "sub-count", {}]));
    expect(sent.some((msg) => msg.includes('"COUNT"'))).toBe(true);

    await relay.websocket.message(ws, JSON.stringify(["EVENT", event]));
    await relay.websocket.message(ws, JSON.stringify(["REQ", "sub-req", {}]));

    await relay.websocket.message(ws, JSON.stringify(["AUTH", { id: "bad", kind: 1, tags: [] }]));
    expect(sent.some((msg) => msg.includes('"OK"'))).toBe(true);

    // Cover default branch in match (unreachable with current ClientMessageSchema,
    // but good to have for robustness if schema changes)
    await relay.websocket.message(ws, JSON.stringify(["UNKNOWN", "something"]));

    relay.websocket.close(ws);
    expect(relay.websocket.close).toBeDefined();
  });

  test("relay cleanup task interval and error", async () => {
    const originalSetInterval = global.setInterval;
    const { logger } = await import("../src/utils/logger.ts");
    const originalLogger = logger.error;
    let intervalCallback: any;

    // @ts-ignore
    logger.error = () => {};
    // @ts-ignore
    global.setInterval = (cb: any) => {
      intervalCallback = cb;
      return 1 as any;
    };

    try {
      await using repository = createRepository(":memory:");
      repository.cleanupExpiredEvents = async () => {
        throw new Error("mock cleanup error");
      };
      await using relay = new NostrRelay(repository);
      await relay.init();

      if (intervalCallback) {
        await intervalCallback();
      }
    } finally {
      global.setInterval = originalSetInterval;
      // @ts-ignore
      logger.error = originalLogger;
    }
  });
});
