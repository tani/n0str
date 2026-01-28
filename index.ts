import { config } from "./src/config/args.ts";
import { NostrRelay } from "./src/services/relay.ts";
import { logger } from "./src/utils/logger.ts";
import { getRepository } from "./src/db/repository.ts";

const relay = new NostrRelay(getRepository(), config.port);
await relay.init();

const server = Bun.serve({
  port: config.port,
  fetch: relay.fetch,
  websocket: relay.websocket,
});

void logger.info`n0str relay listening on ws://localhost:${server.port}`;
void logger.info`n0str relay listening on http://localhost:${server.port}`;

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
