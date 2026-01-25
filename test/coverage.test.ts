import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import * as fs from "node:fs";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { handleEvent } from "../src/handlers/event.ts";
import { handleReq } from "../src/handlers/req.ts";
import { defaultRelayInfo, loadRelayInfo, relayInfo } from "../src/config.ts";

describe("config coverage", () => {
  test("invalid schema falls back to defaults", async () => {
    const configPath = resolve("nostra.invalid-schema.json");
    fs.writeFileSync(configPath, JSON.stringify({ name: "bad-config" }), "utf8");
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args) => {
      errors.push(args);
    };
    try {
      const loaded = loadRelayInfo(configPath, console);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = originalError;
      fs.unlinkSync(configPath);
    }
  });

  test("missing config uses defaults", async () => {
    const configPath = resolve("nostra.missing.json");
    const logs: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args);
    };
    try {
      const loaded = loadRelayInfo(configPath, console);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
    }
  });

  test("invalid JSON falls back to defaults", async () => {
    const configPath = resolve("nostra.invalid-json.json");
    fs.writeFileSync(configPath, "{ invalid json", "utf8");
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args) => {
      errors.push(args);
    };
    try {
      const loaded = loadRelayInfo(configPath, console);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = originalError;
      fs.unlinkSync(configPath);
    }
  });

  test("valid config merges with defaults", async () => {
    const configPath = resolve("nostra.valid.json");
    const validConfig = {
      ...defaultRelayInfo,
      name: "Custom Relay",
    };
    fs.writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
    const logs: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args);
    };
    try {
      const loaded = loadRelayInfo(configPath, console);
      expect(loaded.name).toBe("Custom Relay");
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
      fs.unlinkSync(configPath);
    }
  });
});

describe("handlers coverage", () => {
  test("handleEvent rejects malformed event", async () => {
    const sent: string[] = [];
    const ws = {
      send: (msg: string) => sent.push(msg),
      data: { subscriptions: new Map() },
    } as any;
    await handleEvent(ws, [{ bad: "event" }], new Set());
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("error: malformed event");
  });

  test("handleReq enforces subscription limit", async () => {
    const sent: string[] = [];
    const ws = {
      send: (msg: string) => sent.push(msg),
      data: { subscriptions: new Map<string, any>() },
    } as any;
    for (let i = 0; i < relayInfo.limitation.max_subscriptions; i++) {
      ws.data.subscriptions.set(`sub-${i}`, []);
    }
    await handleReq(ws, ["sub", {}]);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("error: max subscriptions reached");
  });
});

describe("relay coverage", () => {
  test("relay fetch branches and websocket message paths", async () => {
    const { relay, runCleanupTick } = await import("../src/relay.ts");
    const sent: string[] = [];
    const ws = {
      send: (msg: string) => sent.push(msg),
      data: { subscriptions: new Map<string, any>(), challenge: "c", relayUrl: "ws://relay" },
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
    expect(await defaultResult.text()).toContain("Nostra Relay");

    await relay.websocket.message(ws, "not json");

    const closeSubId = "sub-close";
    ws.data.subscriptions.set(closeSubId, []);
    await relay.websocket.message(ws, JSON.stringify(["CLOSE", closeSubId]));
    expect(ws.data.subscriptions.has(closeSubId)).toBe(false);

    await relay.websocket.message(
      ws,
      "x".repeat(relayInfo.limitation.max_message_length + 1),
    );
    expect(sent[sent.length - 1]).toContain("error: message too large");

    await relay.websocket.message(ws, JSON.stringify(["COUNT", "sub-count", {}]));
    expect(sent.some((msg) => msg.includes("\"COUNT\""))).toBe(true);

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
    expect(sent.some((msg) => msg.includes("\"OK\""))).toBe(true);

    relay.websocket.close(ws);
  });
});
