import { SqliteEventRepository } from "./sqlite.ts";
import { PgliteEventRepository } from "./pglite.ts";
import { config } from "./args.ts";
import type { IEventRepository } from "./types.ts";

/**
 * Creates an event repository based on the configured engine.
 * @param engine - The database engine to use ('sqlite' or 'pglite').
 * @param path - The path to the database.
 * @returns An instance of IEventRepository.
 */
export function createRepository(engine: string, path: string): IEventRepository {
  if (engine === "pglite") {
    return new PgliteEventRepository(path);
  }
  return new SqliteEventRepository(path);
}

import { logger } from "./logger.ts";

export const repository = createRepository(config.dbEngine, config.database);
void logger.info`Initializing repository with engine: ${config.dbEngine}`;
await repository.init();

export const clear = repository.clear.bind(repository);
export const saveEvent = repository.saveEvent.bind(repository);
export const queryEvents = repository.queryEvents.bind(repository);
export const deleteEvents = repository.deleteEvents.bind(repository);
export const cleanupExpiredEvents = repository.cleanupExpiredEvents.bind(repository);
export const countEvents = repository.countEvents.bind(repository);
export const queryEventsForSync = repository.queryEventsForSync.bind(repository);

// Re-export needed types
export type { ExistingRow } from "./types.ts";
