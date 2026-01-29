import { engines } from "../utils/engines.ts";
import { expect, test, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { relay, relayService } from "../../src/services/server.ts";
import { clear, queryEvents, initRepository, getRepository } from "../../src/db/repository.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe.each(engines)("Engine: %s > NIP-25: Reactions", () => {
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

  test("Reaction (Kind 7) is stored", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const e = finalizeEvent(
      {
        kind: 7,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", "target-id"],
          ["p", "target-pk"],
        ],
        content: "+",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", e]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    const stored = await Array.fromAsync(queryEvents({ kinds: [7] }));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(e.id);

    ws.close();
  });
});
