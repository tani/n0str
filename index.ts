import { NostrRelay } from "./src/services/relay.ts";
import { logger } from "./src/logger.ts";

const relay = new NostrRelay();
await relay.init();

const server = Bun.serve({
  port: relay.port,
  fetch: relay.fetch,
  websocket: relay.websocket,
});

void logger.info`n0str relay listening on ws://localhost:${server.port}`;
