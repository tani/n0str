import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/relay.ts";
import { db, queryEvents } from "../src/db.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { sql } from "drizzle-orm";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-17: Private Direct Messages", () => {
  const dbPath = "nostra.nip17.test.db";
  let server: any;
  let url: string;

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    await db.run(sql`DELETE FROM events`);
    await db.run(sql`DELETE FROM tags`);
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  test("Gift Wrap (Kind 1059) is stored", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const e = finalizeEvent(
      {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", pk]],
        content: "encrypted-seal",
      },
      sk,
    );
    ws.send(JSON.stringify(["EVENT", e]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    const stored = await queryEvents({ kinds: [1059] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(e.id);

    ws.close();
  });
});
