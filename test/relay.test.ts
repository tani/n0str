import { describe, expect, test, spyOn } from "bun:test";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { relayInfo } from "../src/config.ts";

describe("relay coverage", () => {
  test("relay fetch branches and websocket message paths", async () => {
    const { relay, runCleanupTick } = await import("../src/server.ts");
    const sent: string[] = [];
    const ws = {
      send: (msg: string) => sent.push(msg),
      data: {
        subscriptions: new Map<string, any>(),
        challenge: "c",
        relayUrl: "ws://relay",
      },
    } as any;

    await runCleanupTick();
    relay.websocket.open(ws);

    const upgradeServer = {
      upgrade: () => true,
    };
    const upgradeReq = new Request("http://localhost/", {
      headers: { Upgrade: "websocket" },
    });
    const upgradeResult = relay.fetch(upgradeReq, upgradeServer);
    expect(upgradeResult).toBeUndefined();

    const failedUpgradeServer = {
      upgrade: () => false,
    };
    const failedResult = relay.fetch(upgradeReq, failedUpgradeServer) as Response;
    expect(failedResult.status).toBe(400);

    const infoReq = new Request("http://localhost/", {
      headers: { Accept: "application/nostr+json" },
    });
    const infoResult = relay.fetch(infoReq, failedUpgradeServer) as Response;
    expect(infoResult.headers.get("Content-Type")).toBe("application/nostr+json");

    const defaultReq = new Request("http://localhost/");
    const defaultResult = relay.fetch(defaultReq, failedUpgradeServer) as Response;
    expect(defaultResult.headers.get("Content-Type")).toBe("text/html");
    expect(await defaultResult.text()).toContain("n0str Relay");

    await relay.websocket.message(ws, "not json");

    const closeSubId = "sub-close";
    ws.data.subscriptions.set(closeSubId, []);
    await relay.websocket.message(ws, JSON.stringify(["CLOSE", closeSubId]));
    expect(ws.data.subscriptions.has(closeSubId)).toBe(false);

    await relay.websocket.message(ws, "x".repeat(relayInfo.limitation.max_message_length + 1));
    expect(sent[sent.length - 1]).toContain("error: message too large");

    await relay.websocket.message(ws, JSON.stringify(["COUNT", "sub-count", {}]));
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

  test("runCleanupTick coverage", async () => {
    const serverModule = await import("../src/server.ts");
    const repo = await import("../src/repository.ts");

    // Success path
    await serverModule.runCleanupTick();

    // Error path
    const spy = spyOn(repo, "cleanupExpiredEvents").mockImplementation(async () => {
      throw new Error("db error");
    });
    await serverModule.runCleanupTick();
    spy.mockRestore();
  });
});
