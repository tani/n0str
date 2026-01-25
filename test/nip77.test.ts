import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/server.ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";
import { saveEvent, db } from "../src/repository.ts";
import { Negentropy } from "negentropy";

describe("NIP-77 Negentropy Syncing", () => {
  let server: any;
  let url: string;

  beforeEach(async () => {
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
    // Clear DB (optional, but good for isolation if possible. Using different kinds helps)
  });

  afterEach(() => {
    server.stop();
  });

  const sk = generateSecretKey();

  test("NEG-OPEN and initial sync (empty DB)", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    // Create client negentropy
    const neg = new Negentropy(32);
    neg.seal();
    const initialMsg = neg.initiate();

    const subId = "sync1";
    ws.send(JSON.stringify(["NEG-OPEN", subId, { kinds: [1001] }, initialMsg]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "NEG-MSG" && msg[1] === subId) resolve(msg);
      };
    });

    expect(response[0]).toBe("NEG-MSG");
    expect(response[2]).toBeDefined();

    // Reconcile client side
    const [out, have, need] = neg.reconcile(response[2]);
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
    await saveEvent(event);

    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    // Client doesn't have the event
    const neg = new Negentropy(32);
    neg.seal();
    const initialMsg = neg.initiate();

    const subId = "sync2";
    ws.send(JSON.stringify(["NEG-OPEN", subId, { kinds: [1002] }, initialMsg]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "NEG-MSG" && msg[1] === subId) resolve(msg);
      };
    });

    // Client parses response
    const [out, have, need] = neg.reconcile(response[2]);

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
    ws.send(JSON.stringify(["NEG-OPEN", subId, {}, ""])); // Invalid hex but should trigger handler or error
    // sending valid hex just in case
    const neg = new Negentropy(32);
    neg.seal();
    ws.send(JSON.stringify(["NEG-OPEN", subId, {}, neg.initiate()]));

    // Just ensure server doesn't crash on CLOSE
    ws.send(JSON.stringify(["NEG-CLOSE", subId]));

    // Wait a bit
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
  });
});
