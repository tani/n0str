import { config } from "./src/args.ts";
import { NostrRelay } from "./src/services/relay.ts";
import { logger } from "./src/utils/logger.ts";
import { SqliteEventRepository } from "./src/repositories/sqlite.ts";

const repository = new SqliteEventRepository(config.database);
const relay = new NostrRelay(repository, config.port);
await relay.init();

const server = Bun.serve({
  port: config.port,
  fetch: relay.fetch,
  websocket: relay.websocket,
});

void logger.info`n0str relay listening on ws://localhost:${server.port}`;

const shutdown = async () => {
  void logger.info`Shutting down...`;
  server.stop();
  await relay.shutdown();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
