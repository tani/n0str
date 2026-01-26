import { NostrRelay } from "./services/relay.ts";
import { logger } from "./logger.ts";

export const relayService = new NostrRelay();
await relayService.init();

export const relay = {
  port: relayService.port,
  fetch: relayService.fetch,
  websocket: relayService.websocket,
};

export const runCleanupTick = async () => {
  // Access private repository if needed, but for now we can just use the public method on the service if exposed,
  // or use the repository directly since we are in the same package (effectively).
  // However, NostrRelay has a private repository.
  // The service already runs cleanup internally.
  // But for tests that call runCleanupTick manually, we should probably expose it or replicate it.
  // NostrRelay handles interval, but maybe we want to force a run?
  // Let's check NostrRelay. It doesn't expose a 'runCleanupNow' method.
  // But we can import cleanupExpiredEvents from repository.ts which is aliased to the singleton.
  const { cleanupExpiredEvents } = await import("./repository.ts");
  await cleanupExpiredEvents().catch((err) => void logger.error`Cleanup error: ${err}`);
};
