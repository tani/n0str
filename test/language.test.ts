import { expect, test, describe } from "bun:test";
import { LanguageDetector } from "../src/language.ts";

describe("LanguageDetector", () => {
  describe("Script-based detection", () => {
    test("detects Amharic", () => expect(LanguageDetector.detect("ሰላም")).toBe("am"));
    test("detects Arabic", () => expect(LanguageDetector.detect("مرحبا")).toBe("ar"));
    test("detects Japanese (Hiragana)", () =>
      expect(LanguageDetector.detect("こんにちは")).toBe("ja"));
    test("detects Japanese (Katakana)", () =>
      expect(LanguageDetector.detect("コンピュータ")).toBe("ja"));
    test("detects Japanese (Mixed Kanji/Hiragana - should be ja not zh)", () =>
      expect(LanguageDetector.detect("私は学生です")).toBe("ja"));
    test("detects Korean", () => expect(LanguageDetector.detect("안녕하세요")).toBe("ko"));
    test("detects Chinese", () => expect(LanguageDetector.detect("你好")).toBe("zh"));
    test("detects Hindi", () => expect(LanguageDetector.detect("नमस्ते")).toBe("hi"));
    test("detects Russian", () => expect(LanguageDetector.detect("Привет")).toBe("ru"));
    test("detects Vietnamese (Tone marks)", () =>
      expect(LanguageDetector.detect("Phở")).toBe("vi"));
  });

  describe("Unique char-based detection", () => {
    test("detects Yoruba", () => expect(LanguageDetector.detect("Ẹ ku ile")).toBe("yo"));
    test("detects Igbo (with specific char)", () =>
      expect(LanguageDetector.detect("kedu ka ị mere")).toBe("ig"));
    test("detects German", () => expect(LanguageDetector.detect("Fußball")).toBe("de"));
    test("detects Spanish", () => expect(LanguageDetector.detect("Mañana")).toBe("es"));
    test("detects Portuguese", () => expect(LanguageDetector.detect("Não")).toBe("pt"));
    test("detects Turkish", () => expect(LanguageDetector.detect("Teşekkürler")).toBe("tr"));
    test("detects Uzbek", () => expect(LanguageDetector.detect("O'zbekiston")).toBe("uz"));
  });

  describe("Stopword-based detection", () => {
    test("detects Swahili", () => expect(LanguageDetector.detect("Jina langu ni John")).toBe("sw"));
    test("detects Afrikaans", () => expect(LanguageDetector.detect("Dit is 'n toets")).toBe("af"));
    test("detects Hausa", () => expect(LanguageDetector.detect("Yaya ne?")).toBe("ha"));
    test("detects Zulu", () => expect(LanguageDetector.detect("Ngiyabonga kakhulu")).toBe("zu"));
    test("detects English", () =>
      expect(LanguageDetector.detect("The quick brown fox")).toBe("en"));
    test("detects French", () => expect(LanguageDetector.detect("C'est la vie")).toBe("fr"));
    test("detects Indonesian", () =>
      expect(LanguageDetector.detect("Apa yang terjadi")).toBe("id"));
    test("detects Tagalog", () => expect(LanguageDetector.detect("Salamat po")).toBe("tl"));
  });

  describe("CJK Ordering & Conflict Resolution", () => {
    test("Japanese with Kanji is detected as Japanese (because of Hiragana)", () => {
      expect(LanguageDetector.detect("日本に行きます")).toBe("ja");
    });

    test("Pure Chinese is detected as Chinese", () => {
      expect(LanguageDetector.detect("北京欢迎你")).toBe("zh");
    });

    test("Korean mixed with Hanja (if hangul present) is detected as Korean", () => {
      // Modern Korean rarely uses Hanja, but if it does + Hangul, should be ko.
      expect(LanguageDetector.detect("大韓民国 (대한민국)")).toBe("ko");
    });
  });

  describe("Fallback and Unknown", () => {
    test("defaults to English for Latin text without specific markers", () => {
      expect(LanguageDetector.detect("Just some random text")).toBe("en");
    });
    test("returns unknown for numbers", () => {
      expect(LanguageDetector.detect("123456")).toBe("unknown");
    });
    test("returns unknown for symbols", () => {
      expect(LanguageDetector.detect("!@#$%^")).toBe("unknown");
    });
    test("returns unknown for empty string", () => {
      expect(LanguageDetector.detect("")).toBe("unknown");
    });
  });
});
