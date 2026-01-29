import type { Event, Filter } from "nostr-tools";
import type { SimpleBloomFilter } from "../db/bloom.ts";

/**
 * Represents a basic row for event sync, containing only the ID and timestamp.
 */
export type ExistingRow = {
  id: string;
  created_at: number;
};

/**
 * Interface for the event repository, defining methods for event persistence and querying.
 */
export interface IEventRepository {
  /** Initializes the repository (e.g., creating tables). */
  init(): Promise<void>;
  /** Saves a Nostr event. */
  saveEvent(event: Event): Promise<void>;
  /** Deletes events based on author, IDs, or addressable identifiers. */
  deleteEvents(
    pubkey: string,
    eventIds: string[],
    identifiers: string[],
    until: number,
  ): Promise<void>;
  /** Cleans up expired events according to NIP-40. */
  cleanupExpiredEvents(): Promise<void>;
  /** Counts events matching filters (NIP-45). */
  countEvents(filters: Filter[]): Promise<number>;
  /** Queries events matching a single filter. */
  queryEvents(filter: Filter): AsyncIterableIterator<Event>;
  /** Queries basic event info for negentropy sync. */
  queryEventsForSync(filter: Filter): AsyncIterableIterator<ExistingRow>;
  /** Closes the repository connection. */
  close(): Promise<void>;
  /** Clears all data from the repository (mainly for tests). */
  clear(): Promise<void>;
  /** Asynchronous disposal. */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Metadata for a single subscription, including its filters and a Bloom Filter for optimization.
 */
export type SubscriptionData = {
  filters: Filter[];
  bloom?: SimpleBloomFilter;
};

/**
 * Data associated with a WebSocket client connection.
 */
export type ClientData = {
  subscriptions: Map<string, SubscriptionData>;
  challenge: string;
  relayUrl: string;
  pubkey?: string;
  negSubscriptions: Map<string, any>;
};
