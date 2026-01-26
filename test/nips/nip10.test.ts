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

describe("NIP-10: Text Notes and Threads", () => {
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

  test("Kind 1 threads with 'e' and 'p' tags", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    // 1. Root note
    const rootEvent = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "root note",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", rootEvent]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 2. Reply note with NIP-10 tags
    const replyEvent = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000) + 1,
        tags: [
          ["e", rootEvent.id, "", "root"],
          ["p", rootEvent.pubkey],
        ],
        content: "reply note",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", replyEvent]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 3. Query by 'e' tag
    ws.send(JSON.stringify(["REQ", "sub-e", { "#e": [rootEvent.id] }]));
    const msgE = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "EVENT" && msg[1] === "sub-e") resolve(msg);
      };
    });
    expect(msgE[2].id).toBe(replyEvent.id);

    // 4. Query by 'p' tag
    ws.send(JSON.stringify(["REQ", "sub-p", { "#p": [rootEvent.pubkey] }]));
    const msgP = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "EVENT" && msg[1] === "sub-p") resolve(msg);
      };
    });
    expect(msgP[2].id).toBe(replyEvent.id);

    ws.close();
  });
});
