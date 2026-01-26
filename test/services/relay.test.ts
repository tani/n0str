import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { relayInfo } from "../../src/config/index.ts";
import { NostrRelay } from "../../src/services/relay.ts";
import { existsSync, unlinkSync } from "fs";

describe("relay coverage", () => {
  const dbPath = "n0str.relay.test.db";
  let relayService: NostrRelay;

  beforeEach(async () => {
    process.env.DATABASE_PATH = dbPath;
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch {
        // ignore
      }
    }
    relayService = new NostrRelay();
    await relayService.init();
  });

  afterEach(() => {
    relayService.stop();
    // if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  test("relay fetch branches and websocket message paths", async () => {
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

    relayService.websocket.open(ws);

    const upgradeServer = {
      upgrade: () => true,
    };
    const upgradeReq = new Request("http://localhost/", {
      headers: { Upgrade: "websocket" },
    });
    const upgradeResult = relayService.fetch(upgradeReq, upgradeServer);
    expect(upgradeResult).toBeUndefined();

    const failedUpgradeServer = {
      upgrade: () => false,
    };
    const failedResult = relayService.fetch(upgradeReq, failedUpgradeServer) as Response;
    expect(failedResult.status).toBe(400);

    const infoReq = new Request("http://localhost/", {
      headers: { Accept: "application/nostr+json" },
    });
    const infoResult = relayService.fetch(infoReq, failedUpgradeServer) as Response;
    expect(infoResult.headers.get("Content-Type")).toBe("application/nostr+json");

    const defaultReq = new Request("http://localhost/");
    const defaultResult = relayService.fetch(defaultReq, failedUpgradeServer) as Response;
    expect(await defaultResult.text()).toContain("n0str Relay");

    await relayService.websocket.message(ws, "not json");

    const closeSubId = "sub-close";
    ws.data.subscriptions.set(closeSubId, []);
    await relayService.websocket.message(ws, JSON.stringify(["CLOSE", closeSubId]));
    expect(ws.data.subscriptions.has(closeSubId)).toBe(false);

    await relayService.websocket.message(
      ws,
      "x".repeat(relayInfo.limitation.max_message_length + 1),
    );
    expect(sent[sent.length - 1]).toContain("error: message too large");

    await relayService.websocket.message(ws, JSON.stringify(["COUNT", "sub-count", {}]));
    expect(sent.some((msg) => msg.includes('"COUNT"'))).toBe(true);

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
    await relayService.websocket.message(ws, JSON.stringify(["EVENT", event]));
    await relayService.websocket.message(ws, JSON.stringify(["REQ", "sub-req", {}]));

    await relayService.websocket.message(
      ws,
      JSON.stringify(["AUTH", { id: "bad", kind: 1, tags: [] }]),
    );
    expect(sent.some((msg) => msg.includes('"OK"'))).toBe(true);

    // Cover default branch in match (unreachable with current ClientMessageSchema,
    // but good to have for robustness if schema changes)
    await relayService.websocket.message(ws, JSON.stringify(["UNKNOWN", "something"]));

    relayService.websocket.close(ws);
    expect(relayService.websocket.close).toBeDefined();
  });
});
