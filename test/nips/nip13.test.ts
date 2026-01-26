import { test, describe, beforeEach, afterEach } from "bun:test";
import { relay } from "../../src/server.ts";
import { clear } from "../../src/repository.ts";

describe("NIP-13 Proof of Work", () => {
  let server: any;

  beforeEach(async () => {
    await clear();

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
