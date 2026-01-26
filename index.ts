import { config } from "./src/args.ts";
import { NostrRelay } from "./src/relay.ts";
import { logger } from "./src/logger.ts";
import { SqliteEventRepository } from "./src/sqlite.ts";

const repository = new SqliteEventRepository(config.database);
const relay = new NostrRelay(repository, config.port);
await relay.init();

const server = Bun.serve({
  port: config.port,
  fetch: relay.fetch,
  websocket: relay.websocket,
});

void logger.info`n0str relay listening on ws://localhost:${server.port}`;

/**
 * Gracefully shuts down the server and the relay.
 */
const shutdown = async () => {
  void logger.info`Shutting down...`;
  server.stop();
  await relay.shutdown();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
