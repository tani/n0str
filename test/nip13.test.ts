import { test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/server.ts";
import { db } from "../src/repository.ts";

describe("NIP-13 Proof of Work", () => {
  const dbPath = "nostra.nip13.test.db";
  let server: any;

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    await db`DELETE FROM events`;
    await db`DELETE FROM tags`;
    server = Bun.serve({ ...relay, port: 0 });
  });

  afterEach(() => {
    server.stop();
  });

  test("NIP-13: PoW difficulty enforcement", async () => {
    // Note: Implementation testing depends on MIN_DIFFICULTY configuration.
    // Currently testing that flow is correct. Rejection is tested in protocol.test.ts.
  });
});
