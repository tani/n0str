import { NostrRelay } from "./relay.ts";
import { logger } from "../utils/logger.ts";
import { getRepository } from "../db/repository.ts";
import { config } from "../config/args.ts";

/**
 * The core NostrRelay service instance.
 */
export const relayService = new NostrRelay(getRepository(), config.port);
await relayService.init();

/**
 * A simplified relay object exposed for Bun.serve.
 */
export const relay = {
  port: relayService.port,
  fetch: relayService.fetch,
  websocket: relayService.websocket,
};

/**
 * Manually triggers a cleanup of expired events.
 */
export const runCleanupTick = async () => {
  const { cleanupExpiredEvents } = await import("../db/repository.ts");
  await cleanupExpiredEvents().catch((err: unknown) => void logger.error`Cleanup error: ${err}`);
};
