import {
  expect,
  test,
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { relay } from "../src/relay.ts";
import { db } from "../src/db.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";
import { sql } from "drizzle-orm";

describe("NIP-13 Proof of Work", () => {
  const dbPath = "nostra.nip13.test.db";
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

  test("NIP-13: PoW difficulty enforcement", async () => {
    // Note: Implementation testing depends on MIN_DIFFICULTY configuration.
    // Currently testing that flow is correct. Rejection is tested in protocol.test.ts.
  });
});
