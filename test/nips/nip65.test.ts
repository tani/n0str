import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { createTestEnv } from "../utils/test_helper.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-65: Relay List Metadata", () => {
  let server: any;
  let url: string;
  let repository: any;
  let relayService: any;
  let db: any;
  let queryEvents: any;

  beforeEach(async () => {
    const env = await createTestEnv();
    server = env.server;
    url = env.url;
    repository = env.repository;
    relayService = env.relayService;
    db = env.db;
    queryEvents = repository.queryEvents.bind(repository);
  });

  afterEach(async () => {
    server.stop();
    await repository.close();
  });

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  test("Relay List Metadata (Kind 10002) follows replaceable logic", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);
    const kind = 10002;

    const e1 = finalizeEvent(
      {
        kind,
        created_at: now,
        tags: [["r", "wss://relay1.com"]],
        content: "",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", e1]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    const e2 = finalizeEvent(
      {
        kind,
        created_at: now + 1,
        tags: [["r", "wss://relay2.com"]],
        content: "",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", e2]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    const stored = await queryEvents({ kinds: [kind], authors: [pk] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tags).toHaveLength(1);
    expect(stored[0]?.tags[0]?.[1]).toBe("wss://relay2.com");

    ws.close();
  });
});
