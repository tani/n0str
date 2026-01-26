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

describe("NIP-57: Lightning Zaps", () => {
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

  test("Zap Request (Kind 9734) and Zap Receipt (Kind 9735) are stored", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    for (const kind of [9734, 9735]) {
      const e = finalizeEvent(
        {
          kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["p", "target-pubkey"]],
          content: "zap content",
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", e]));
      await new Promise((resolve) => {
        ws.onmessage = (e) => {
          if (JSON.parse(e.data)[0] === "OK") resolve(null);
        };
      });

      const stored = await queryEvents({ kinds: [kind] });
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe(e.id);
      await db.query("DELETE FROM events");
    }

    ws.close();
  });
});
