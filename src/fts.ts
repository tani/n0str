import { eld } from "eld/large";

const segmenters = new Map<string, Intl.Segmenter>();

function getSegmenter(locale: string) {
  const key = locale || "und";
  let segmenter = segmenters.get(key);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(key, { granularity: "word" });
    segmenters.set(key, segmenter);
  }
  return segmenter;
}

function detectLocale(text: string) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "und";
  const result = eld.detect(trimmed);
  if (!result.language || !result.isReliable()) return "und";
  return result.language;
}

function segmentWords(text: string, locale: string) {
  const segmenter = getSegmenter(locale);
  const tokens: string[] = [];
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) tokens.push(segment.segment);
  }
  return tokens.length > 0 ? tokens.join(" ") : text;
}

export function segmentForFts(text: string) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  const locale = detectLocale(trimmed);
  return segmentWords(trimmed, locale);
}

export function segmentSearchQuery(text: string) {
  return segmentForFts(text);
}
