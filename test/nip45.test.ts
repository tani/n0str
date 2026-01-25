import { Effect } from "effect";
import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/relay.ts";
import { db } from "../src/db.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { sql } from "drizzle-orm";
import type { Server } from "bun";

const consumeAuth = (ws: WebSocket) =>
  Effect.async<string>((resume) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resume(Effect.succeed(msg[1]));
    };
  });

describe("NIP-45 Event Counts", () => {
  const dbPath = "nostra.nip45.test.db";
  let server: Server;
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

  test("NIP-45: COUNT message", async () => {
    const testEffect = Effect.gen(function* () {
      const ws = new WebSocket(url);
      yield* Effect.async<void>((resume) => {
         ws.onopen = () => resume(Effect.void);
      });
      yield* consumeAuth(ws);

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
        yield* Effect.async<void>((resume) => {
          ws.onmessage = (e) => {
            if (JSON.parse(e.data)[0] === "OK") resume(Effect.void);
          };
        });
      }

      const subId = "count-sub";
      ws.send(JSON.stringify(["COUNT", subId, { kinds: [1] }]));

      const response = yield* Effect.async<unknown>((resume) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg[0] === "COUNT") resume(Effect.succeed(msg));
        };
      });

      // @ts-expect-error - response is unknown
      expect(response[0]).toBe("COUNT");
      // @ts-expect-error - response is unknown
      expect(response[1]).toBe(subId);
      // @ts-expect-error - response is unknown
      expect(response[2].count).toBe(3);

      ws.close();
    });

    await Effect.runPromise(testEffect);
  });
});
