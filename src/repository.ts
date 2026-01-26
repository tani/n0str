import { SqliteEventRepository } from "./repositories/sqlite.ts";

export const repository = new SqliteEventRepository();
await repository.init();

export const db = repository.db;
export const saveEvent = repository.saveEvent.bind(repository);
export const queryEvents = repository.queryEvents.bind(repository);
export const deleteEvents = repository.deleteEvents.bind(repository);
export const cleanupExpiredEvents = repository.cleanupExpiredEvents.bind(repository);
export const countEvents = repository.countEvents.bind(repository);
export const queryEventsForSync = repository.queryEventsForSync.bind(repository);

// Re-export needed types
export type { ExistingRow } from "./repositories/types.ts";
