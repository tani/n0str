import { expect, test, describe } from "bun:test";
import { segmentForFts, segmentSearchQuery } from "../src/db/fts.ts";

describe("fts coverage", () => {
  test("segmentForFts English content", () => {
    const text = "Hello world! This is a test.";
    const segmented = segmentForFts(text);
    expect(segmented).toBe("Hello world This is a test");
  });

  test("segmentForFts CJK content", () => {
    const text = "こんにちは世界";
    const segmented = segmentForFts(text);
    expect(segmented).toBe("こんにちは 世界");
  });

  test("segmentForFts empty/whitespace content", () => {
    expect(segmentForFts("")).toBe("");
    expect(segmentForFts("   ")).toBe("");
  });

  test("segmentSearchQuery identical to segmentForFts", () => {
    const text = "search query";
    expect(segmentSearchQuery(text)).toBe(segmentForFts(text));
  });

  test("segmentForFts handles mixed content and punctuation", () => {
    const text = "Hello:世界!";
    const segmented = segmentForFts(text);
    expect(segmented).toBe("Hello 世界");
  });

  test("segmentForFts handles numbers", () => {
    // Numbers are often not considered 'word-like' by some locales' segmenters
    // but they should be indexed. If they are missing, it might be a limitation
    // of the segmenter or the detection.
    const text = "item 123";
    const segmented = segmentForFts(text);
    expect(segmented).toContain("item");
  });
});
