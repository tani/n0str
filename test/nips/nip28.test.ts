import { engines } from "../utils/engines.ts";
import { expect, test, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { relay, relayService } from "../../src/server.ts";
import { clear, queryEvents, initRepository, getRepository } from "../../src/repository.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe.each(engines)("Engine: %s > NIP-28: Public Chat", () => {
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

  test("Channel Creation (Kind 40) is stored", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const e = finalizeEvent(
      {
        kind: 40,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify({ name: "Channel", about: "Topic" }),
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", e]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    const stored = await queryEvents({ kinds: [40] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(e.id);

    ws.close();
  });
});
