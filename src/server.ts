import { NostrRelay } from "./services/relay.ts";
import { logger } from "./utils/logger.ts";
import { SqliteEventRepository } from "./repositories/sqlite.ts";

const dbPath = process.env.DATABASE_PATH || "n0str.db";
const port = parseInt(process.env.PORT || "3000");
const repository = new SqliteEventRepository(dbPath);

export const relayService = new NostrRelay(repository, port);
await relayService.init();

export const relay = {
  port: relayService.port,
  fetch: relayService.fetch,
  websocket: relayService.websocket,
};

export const runCleanupTick = async () => {
  const { cleanupExpiredEvents } = await import("./repository.ts");
  await cleanupExpiredEvents().catch((err) => void logger.error`Cleanup error: ${err}`);
};
