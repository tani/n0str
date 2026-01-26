import type { Filter } from "nostr-tools";

/**
 * Data associated with a WebSocket client connection.
 */
export type ClientData = {
  subscriptions: Map<string, Filter[]>;
  challenge: string;
  relayUrl: string;
  pubkey?: string;
  negSubscriptions: Map<string, any>;
};
