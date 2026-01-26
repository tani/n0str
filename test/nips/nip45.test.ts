import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { createTestEnv } from "../utils/test_helper.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-45 Event Counts", () => {
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

  test("NIP-45: COUNT message", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    for (let i = 0; i < 3; i++) {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: `test ${i}`,
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", event]));
      await new Promise((resolve) => {
        ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "OK") resolve(null);
        };
      });
    }

    const subId = "count-sub";
    ws.send(JSON.stringify(["COUNT", subId, { kinds: [1] }]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "COUNT") resolve(msg);
      };
    });

    expect(response[0]).toBe("COUNT");
    expect(response[1]).toBe(subId);
    expect(response[2].count).toBe(3);

    ws.close();
  });
});
