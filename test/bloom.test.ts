import { expect, test, describe } from "bun:test";
import { SimpleBloomFilter } from "../src/bloom.ts";

describe("SimpleBloomFilter", () => {
  test("basic add and test", () => {
    const filter = new SimpleBloomFilter(10, 0.01);
    filter.add("hello");
    filter.add("world");

    expect(filter.test("hello")).toBe(true);
    expect(filter.test("world")).toBe(true);
    expect(filter.test("not exist")).toBe(false);
  });

  test("false positive rate (approximate)", () => {
    // Large enough filter to check FPR
    const filter = new SimpleBloomFilter(100, 0.01);
    const items = Array.from({ length: 100 }, (_, i) => `item-${i}`);
    for (const item of items) {
      filter.add(item);
    }

    // All added items must match (no false negatives)
    for (const item of items) {
      expect(filter.test(item)).toBe(true);
    }

    // Check FPR with non-added items
    let falsePositives = 0;
    const testCount = 1000;
    for (let i = 0; i < testCount; i++) {
      if (filter.test(`test-${i}`)) {
        falsePositives++;
      }
    }

    const actualFPR = falsePositives / testCount;
    // 0.01 is target, we allow some variance but it should be low.
    expect(actualFPR).toBeLessThan(0.05);
  });

  test("empty filter", () => {
    const filter = new SimpleBloomFilter(10);
    expect(filter.test("anything")).toBe(false);
  });

  test("large items", () => {
    const filter = new SimpleBloomFilter(10);
    const largeItem = "a".repeat(1024);
    filter.add(largeItem);
    expect(filter.test(largeItem)).toBe(true);
    expect(filter.test(largeItem + "b")).toBe(false);
  });

  test("default parameters", () => {
    const filter = new SimpleBloomFilter();
    filter.add("test");
    expect(filter.test("test")).toBe(true);
  });
});
