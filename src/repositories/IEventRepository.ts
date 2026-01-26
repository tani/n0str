import type { Event, Filter } from "nostr-tools";

export type ExistingRow = {
  id: string;
  created_at: number;
};

export interface IEventRepository {
  init(): Promise<void>;
  saveEvent(event: Event): Promise<void>;
  deleteEvents(
    pubkey: string,
    eventIds: string[],
    identifiers: string[],
    until: number,
  ): Promise<void>;
  cleanupExpiredEvents(): Promise<void>;
  countEvents(filters: Filter[]): Promise<number>;
  queryEvents(filter: Filter): Promise<Event[]>;
  queryEventsForSync(filter: Filter): Promise<ExistingRow[]>;
}
