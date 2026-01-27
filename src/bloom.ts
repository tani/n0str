/**
 * SimpleBloomFilter
 * A space-efficient probabilistic data structure for fast set-membership checks.
 * Optimized for Nostr relay filtering using Bun's fast hashing.
 */
export class SimpleBloomFilter {
  private bits: Uint32Array;
  private size: number;
  private k: number;

  /**
   * @param expectedItems - Number of items expected to be stored.
   * @param falsePositiveRate - Desired false positive probability (e.g., 0.01 for 1%).
   */
  constructor(expectedItems: number = 100, falsePositiveRate: number = 0.01) {
    // Calculate optimal size (m) and number of hash functions (k)
    this.size = Math.ceil(-(expectedItems * Math.log(falsePositiveRate)) / Math.log(2) ** 2);
    this.k = Math.ceil((this.size / expectedItems) * Math.log(2));

    // Ensure size is a multiple of 32 for Uint32Array
    const arraySize = Math.ceil(this.size / 32);
    this.bits = new Uint32Array(arraySize);
  }

  /**
   * Adds an item to the Bloom filter.
   */
  add(item: string): void {
    for (let i = 0; i < this.k; i++) {
      const hash = BigInt(Bun.hash(item, i)) % BigInt(this.size);
      const index = Number(hash);
      const bitIndex = index >>> 5;
      const current = this.bits[bitIndex] ?? 0;
      this.bits[bitIndex] = current | (1 << (index & 31));
    }
  }

  /**
   * Checks if an item might be in the set.
   * Returns false if the item is DEFINITELY not in the set.
   * Returns true if the item MIGHT be in the set.
   */
  test(item: string): boolean {
    for (let i = 0; i < this.k; i++) {
      const hash = BigInt(Bun.hash(item, i)) % BigInt(this.size);
      const index = Number(hash);
      const word = this.bits[index >>> 5];
      if (word === undefined || !(word & (1 << (index & 31)))) {
        return false;
      }
    }
    return true;
  }
}
