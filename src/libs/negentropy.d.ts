/**
 * In-memory storage for negentropy sync.
 */
export class NegentropyStorageVector {
  constructor();
  insert(timestamp: number, id: Uint8Array | string): void;
  seal(): void;
  unseal(): void;
  size(): number;
  getItem(i: number): { timestamp: number; id: Uint8Array };
  iterate(
    begin: number,
    end: number,
    cb: (item: { timestamp: number; id: Uint8Array }, i: number) => boolean,
  ): void;
  findLowerBound(begin: number, end: number, bound: { timestamp: number; id: Uint8Array }): number;
  /** Computes a fingerprint for the given range. */
  fingerprint(begin: number, end: number): Promise<Uint8Array>;
}

/**
 * Negentropy protocol implementation for efficient set reconciliation.
 */
export class Negentropy {
  constructor(storage: NegentropyStorageVector, frameSizeLimit?: number);
  initiate(): Promise<string>;
  setInitiator(): void;
  /** Continues the reconciliation process with a message from the other party. */
  reconcile(query: string | Uint8Array): Promise<[string | null, string[], string[]]>;
}
