declare module "negentropy" {
  export class Negentropy {
    constructor(idSize: number, frameSizeLimit?: number);
    addItem(timestamp: number, id: Uint8Array | string): void;
    seal(): void;
    initiate(): string; // Returns hex string
    reconcile(query: string | Uint8Array): [string, string[], string[]];
  }
}
