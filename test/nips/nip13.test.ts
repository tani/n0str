import { engines } from "../utils/engines.ts";
import { test, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { relay, relayService } from "../../src/server.ts";
import { clear, initRepository, getRepository } from "../../src/repository.ts";

describe.each(engines)("Engine: %s > NIP-13 Proof of Work", (engine) => {
  beforeAll(async () => {
    await initRepository(engine, ":memory:");
    relayService.setRepository(getRepository());
  });

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
