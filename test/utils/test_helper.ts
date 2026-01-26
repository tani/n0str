import { PgLiteEventRepository } from "../../src/pglite.ts";
import { NostrRelay } from "../../src/relay.ts";
import { type Server } from "bun";

export async function createTestEnv() {
  const repository = new PgLiteEventRepository(); // In-memory
  await repository.init();
  const relayService = new NostrRelay(repository);
  await relayService.init();

  const server = Bun.serve({
    port: 0,
    fetch: relayService.fetch.bind(relayService),
    websocket: relayService.websocket,
  });

  return {
    repository,
    relayService,
    server,
    url: `ws://localhost:${server.port}`,
    db: repository.db,
  };
}
