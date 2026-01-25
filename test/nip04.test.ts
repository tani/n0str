import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/relay.ts";
import { db } from "../src/db.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-04: Encrypted Direct Messages", () => {
  const dbPath = "nostra.nip04.test.db";
  let server: any;
  let url: string;

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    await db`DELETE FROM events`;
    await db`DELETE FROM tags`;
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  const sk1 = generateSecretKey();
  const pk1 = getPublicKey(sk1);
  const sk2 = generateSecretKey();
  const pk2 = getPublicKey(sk2);

  test("Kind 4 events are stored and searchable by recipient", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const dmEvent = finalizeEvent(
      {
        kind: 4,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", pk2]],
        content: "encrypted_text?iv=initialization_vector",
      },
      sk1,
    );

    ws.send(JSON.stringify(["EVENT", dmEvent]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // Verify recipient can find it by querying their pubkey in 'p' tag
    ws.send(JSON.stringify(["REQ", "sub1", { "#p": [pk2] }]));
    const msg = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data[0] === "EVENT") resolve(data);
      };
    });
    expect(msg[2].id).toBe(dmEvent.id);
    expect(msg[2].pubkey).toBe(pk1);

    ws.close();
  });
});
