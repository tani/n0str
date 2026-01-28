import { expect, test, describe, beforeAll } from "bun:test";
import { engines } from "./utils/engines.ts";
import { initRepository, getRepository } from "../src/db/repository.ts";
import { relayService, relay, runCleanupTick } from "../src/services/server.ts";

describe.each(engines)("Engine: %s > Server", () => {
  beforeAll(async () => {
    await initRepository(":memory:");
    relayService.setRepository(getRepository());
  });

  test("relay object contains expected handlers", () => {
    expect(relay.port).toBeDefined();
    expect(relay.fetch).toBeDefined();
    expect(relay.websocket).toBeDefined();
  });

  test("runCleanupTick executes without crashing", async () => {
    // This mostly covers the branch coverage for runCleanupTick
    await expect(runCleanupTick()).resolves.toBeUndefined();
  });

  test("runCleanupTick handles error", async () => {
    const { logger } = await import("../src/utils/logger.ts");
    const originalRepo = getRepository().cleanupExpiredEvents;
    const originalLogger = logger.error;

    getRepository().cleanupExpiredEvents = async () => {
      throw new Error("mock cleanup error");
    };
    // @ts-ignore
    logger.error = () => {};

    try {
      await expect(runCleanupTick()).resolves.toBeUndefined();
    } finally {
      getRepository().cleanupExpiredEvents = originalRepo;
      // @ts-ignore
      logger.error = originalLogger;
    }
  });

  test("relayService is initialized", () => {
    expect(relayService).toBeDefined();
  });
});
