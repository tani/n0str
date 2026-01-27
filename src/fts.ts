import { LanguageDetector } from "./language.ts";

const segmenters = new Map<string, Intl.Segmenter>();

/**
 * Gets or creates an Intl.Segmenter for a given locale.
 * @param locale - The BCP 47 language tag.
 * @returns An Intl.Segmenter instance.
 */
function getSegmenter(locale: string) {
  const key = locale || "und";
  let segmenter = segmenters.get(key);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(key, { granularity: "word" });
    segmenters.set(key, segmenter);
  }
  return segmenter;
}

/**
 * Detects the language of a given text.
 * @param text - The text to analyze.
 * @returns The detected language code or "und" if unreliable.
 */
function detectLocale(text: string) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "und";
  const language = LanguageDetector.detect(trimmed);
  if (language === "unknown") return "und";
  return language;
}

/**
 * Segments text into words based on the locale.
 * Useful for languages that don't use spaces (e.g., CJK).
 * @param text - The text to segment.
 * @param locale - The locale to use for segmentation.
 * @returns A space-separated string of words.
 */
function segmentWords(text: string, locale: string) {
  const segmenter = getSegmenter(locale);
  const tokens: string[] = [];
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) tokens.push(segment.segment);
  }
  return tokens.length > 0 ? tokens.join(" ") : text;
}

/**
 * Prepares text for SQLite FTS5 index by segmenting it into words.
 * @param text - The raw event content.
 * @returns Segmented text ready for indexing.
 */
export function segmentForFts(text: string) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  const locale = detectLocale(trimmed);
  return segmentWords(trimmed, locale);
}

/**
 * Prepares a search query for SQLite FTS5 by segmenting it.
 * @param text - The search query string.
 * @returns Segmented search query.
 */
export function segmentSearchQuery(text: string) {
  return segmentForFts(text);
}
