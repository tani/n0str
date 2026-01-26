import { NostrRelay } from "./relay.ts";
import { logger } from "./logger.ts";
import { SqliteEventRepository } from "./sqlite.ts";

const dbPath = process.env.DATABASE_PATH || "n0str.db";
const port = parseInt(process.env.PORT || "3000");
const repository = new SqliteEventRepository(dbPath);

/**
 * The core NostrRelay service instance.
 */
export const relayService = new NostrRelay(repository, port);
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
  const { cleanupExpiredEvents } = await import("./repository.ts");
  await cleanupExpiredEvents().catch((err: unknown) => void logger.error`Cleanup error: ${err}`);
};
