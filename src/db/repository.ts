import { SqliteEventRepository } from "./sqlite.ts";
import { config } from "../config/args.ts";
import type { IEventRepository } from "../domain/types.ts";
import { logger } from "../utils/logger.ts";

/**
 * Creates an event repository.
 * @param path - The path to the database.
 * @returns An instance of IEventRepository.
 */
export function createRepository(path: string): IEventRepository {
  return new SqliteEventRepository(path);
}

let repository: IEventRepository;

/**
 * Initializes the global repository singleton.
 */
export async function initRepository(database: string) {
  void logger.info`Initializing repository (sqlite)`;
  if (repository) {
    await repository.close();
  }
  repository = createRepository(database);
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
await initRepository(config.database);

/**
 * Returns the current repository instance.
 * @returns The active IEventRepository.
 */
export const getRepository = () => repository;

// Re-export needed types
export type { ExistingRow } from "../domain/types.ts";
export type { IEventRepository };
