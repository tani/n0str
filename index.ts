import { relay } from "./src/server.ts";
import { setupLogger, logger } from "./src/logger.ts";

await setupLogger();

const server = Bun.serve(relay);

logger.info(`n0str relay listening on ws://localhost:${server.port}`);
