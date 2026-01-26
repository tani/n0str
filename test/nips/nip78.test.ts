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

describe("NIP-78: Application-specific Data", () => {
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

  test("App Data (Kind 30078) follows d-tag replacement logic", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);
    const kind = 30078;

    const e1 = finalizeEvent(
      {
        kind,
        created_at: now,
        tags: [["d", "settings"]],
        content: '{"theme": "dark"}',
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
        tags: [["d", "settings"]],
        content: '{"theme": "light"}',
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
    expect(stored[0]?.content).toBe('{"theme": "light"}');

    ws.close();
  });
});
