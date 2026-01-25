import { relay } from "./src/server.ts";
import { logger } from "./src/logger.ts";

const server = Bun.serve(relay);

void logger.info`n0str relay listening on ws://localhost:${server.port}`;
