import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createTestEnv } from "../utils/test_helper.ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { Negentropy, NegentropyStorageVector } from "../../src/negentropy.js";

describe("NIP-77 Negentropy Syncing", () => {
  let server: any;
  let url: string;
  let repository: any;
  let relayService: any;
  let db: any;

  beforeEach(async () => {
    const env = await createTestEnv();
    server = env.server;
    url = env.url;
    repository = env.repository;
    relayService = env.relayService;
    db = env.db;
  });

  afterEach(async () => {
    server.stop();
    await repository.close();
  });

  const sk = generateSecretKey();

  test("NEG-OPEN and initial sync (empty DB)", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    // Create client negentropy
    const storage = new NegentropyStorageVector();
    storage.seal();
    const neg = new Negentropy(storage);
    const initialMsg = await neg.initiate();

    const subId = "sync1";
    ws.send(JSON.stringify(["NEG-OPEN", subId, { kinds: [1001] }, initialMsg]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "NEG-MSG" && msg[1] === subId) resolve(msg);
      };
    });

    expect(response[0]).toBe("NEG-MSG");
    // response[2] can be null or string

    // Reconcile client side
    const [_out, have, need] = await neg.reconcile(response[2] ?? "");
    expect(have.length).toBe(0);
    expect(need.length).toBe(0); // DB is empty

    ws.close();
  });

  test("NEG-OPEN with data in DB", async () => {
    // 1. Insert an event
    const event = finalizeEvent(
      {
        kind: 1002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "sync me",
      },
      sk,
    );
    await repository.saveEvent(event);

    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    // Client doesn't have the event
    const storage = new NegentropyStorageVector();
    storage.seal();
    const neg = new Negentropy(storage);
    const initialMsg = await neg.initiate();

    const subId = "sync2";
    ws.send(JSON.stringify(["NEG-OPEN", subId, { kinds: [1002] }, initialMsg]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "NEG-MSG" && msg[1] === subId) resolve(msg);
      };
    });

    // Client parses response
    const [_out, _have, need] = await neg.reconcile(response[2] ?? "");

    // Relay should have the event, client needs it.
    // Wait, "need" means "IDs client needs (relay has)".
    // "have" means "IDs client has (relay needs)".
    expect(need.length).toBe(1);
    expect(need[0]).toBe(event.id);

    ws.close();
  });

  test("NEG-CLOSE cleans up", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    const subId = "sync3";

    // Test invalid initial message
    ws.send(JSON.stringify(["NEG-OPEN", subId, {}, "invalid hex"]));
    const errResponse = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "NEG-ERR" && msg[1] === subId) resolve(msg);
      };
    });
    expect(errResponse[0]).toBe("NEG-ERR");

    // Re-open with valid message
    const storage = new NegentropyStorageVector();
    storage.seal();
    const neg = new Negentropy(storage);
    const initMsg = await neg.initiate();
    ws.send(JSON.stringify(["NEG-OPEN", subId, {}, initMsg]));

    // Re-open same subId (should log 'Replacing existing neg subscription')
    ws.send(JSON.stringify(["NEG-OPEN", subId, {}, initMsg]));

    // Test NEG-MSG for unknown sub
    ws.send(JSON.stringify(["NEG-MSG", "unknown-sub", "00"]));
    const unknownSubErr = await new Promise<any>((resolve) => {
      const originalOnMessage = ws.onmessage;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "NEG-ERR" && msg[1] === "unknown-sub") {
          ws.onmessage = originalOnMessage;
          resolve(msg);
        }
      };
    });
    expect(unknownSubErr[2]).toContain("subscription not found");

    // Test valid NEG-MSG
    ws.send(JSON.stringify(["NEG-MSG", subId, initMsg]));

    // Test invalid NEG-MSG (to trigger catch block)
    ws.send(JSON.stringify(["NEG-MSG", subId, "invalid hex"]));
    const negMsgErr = await new Promise<any>((resolve) => {
      const originalOnMessage = ws.onmessage;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "NEG-ERR" && msg[1] === subId) {
          ws.onmessage = originalOnMessage;
          resolve(msg);
        }
      };
    });
    expect(negMsgErr[0]).toBe("NEG-ERR");

    // Just ensure server doesn't crash on CLOSE
    ws.send(JSON.stringify(["NEG-CLOSE", subId]));

    // Wait a bit
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
  });
});
