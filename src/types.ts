import type { Filter } from "nostr-tools";

export type ClientData = {
  subscriptions: Map<string, Filter[]>;
  challenge: string;
  relayUrl: string;
  pubkey?: string;
};
