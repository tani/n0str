import { engines } from "../utils/engines.ts";
import { expect, test, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { relay, relayService } from "../../src/services/server.ts";
import { clear, queryEvents, initRepository, getRepository } from "../../src/db/repository.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe.each(engines)("Engine: %s > NIP-02: Follow List", () => {
  beforeAll(async () => {
    await initRepository(":memory:");
    relayService.setRepository(getRepository());
  });

  let server: any;
  let url: string;

  beforeEach(async () => {
    await clear();

    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  test("Kind 3 events follow replacement logic", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);

    // 1. Publish first follow list
    const event1 = finalizeEvent(
      {
        kind: 3,
        created_at: now - 10,
        tags: [["p", "pubkey1", "", "name1"]],
        content: "follow list 1",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", event1]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 2. Publish second follow list (newer)
    const event2 = finalizeEvent(
      {
        kind: 3,
        created_at: now,
        tags: [
          ["p", "pubkey1", "", "name1"],
          ["p", "pubkey2", "", "name2"],
        ],
        content: "follow list 2",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", event2]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 3. Verify only the newer one is stored
    const stored = await Array.fromAsync(queryEvents({ kinds: [3], authors: [pk] }));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(event2.id);
    expect(stored[0]?.tags).toHaveLength(2);

    ws.close();
  });
});
