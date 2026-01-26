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

let repository: IEventRepository;

/**
 * Initializes the global repository singleton.
 */
export async function initRepository(engine: string, database: string) {
  void logger.info`Initializing repository with engine: ${engine}`;
  if (repository) {
    await repository.close();
  }
  repository = createRepository(engine, database);
  await repository.init();
}

// Global accessor functions that point to the current repository instance
export const clear = () => repository.clear();
export const saveEvent = (event: any) => repository.saveEvent(event);
export const queryEvents = (filter: any) => repository.queryEvents(filter);
export const deleteEvents = (pubkey: string, ids: string[], identifiers: string[], until: number) =>
  repository.deleteEvents(pubkey, ids, identifiers, until);
export const cleanupExpiredEvents = () => repository.cleanupExpiredEvents();
export const countEvents = (filter: any) => repository.countEvents(filter);
export const queryEventsForSync = (filter: any) => repository.queryEventsForSync(filter);
export const close = () => repository.close();

// Initialize with defaults from config
await initRepository(config.dbEngine, config.database);

/**
 * Returns the current repository instance.
 * @returns The active IEventRepository.
 */
export const getRepository = () => repository;

// Re-export needed types
export type { ExistingRow } from "./types.ts";
export type { IEventRepository };
