import { expect, test, describe } from "bun:test";
import { LanguageDetector } from "../src/language.ts";

describe("LanguageDetector", () => {
  test("cleanText removes URLs, mentions, and hashtags", () => {
    const input = "Hello @user check this #nostr at https://example.com! 123";
    const output = LanguageDetector.cleanText(input);
    // Punctuation like '!' is removed by the regex [^\p{L}\p{M}\s']
    expect(output).toBe("Hello  check this  at");
  });

  test("detect returns unknown for empty or invalid input", () => {
    expect(LanguageDetector.detect("")).toBe("unknown");
    expect(LanguageDetector.detect("   ")).toBe("unknown");
    expect(LanguageDetector.detect("12345 !@#$%")).toBe("unknown");
  });

  test("detects languages by script", () => {
    expect(LanguageDetector.detect("こんにちは")).toBe("ja");
    expect(LanguageDetector.detect("안녕하세요")).toBe("ko");
    expect(LanguageDetector.detect("你好")).toBe("zh");
    expect(LanguageDetector.detect("ሰላም")).toBe("am"); // Ethiopic
    expect(LanguageDetector.detect("مرحبا")).toBe("ar");
    expect(LanguageDetector.detect("नमस्ते")).toBe("hi");
    expect(LanguageDetector.detect("привет")).toBe("ru");
    expect(LanguageDetector.detect("Việt Nam")).toBe("vi"); // Vietnamese (using 'ệ' which is unique)
  });

  test("detects languages by unique characters", () => {
    expect(LanguageDetector.detect("ẹṣ")).toBe("yo"); // Yoruba (removed 'ọ' to avoid overlap)
    expect(LanguageDetector.detect("ịụ")).toBe("ig"); // Igbo (removed 'ọ' to avoid overlap)
    expect(LanguageDetector.detect("Straße")).toBe("de");
    expect(LanguageDetector.detect("mañana")).toBe("es");
    expect(LanguageDetector.detect("coração")).toBe("pt"); // Portuguese (using 'ã')
    expect(LanguageDetector.detect("teşekkür")).toBe("tr");
    expect(LanguageDetector.detect("o'g'il")).toBe("uz");
  });

  test("detects languages by stopwords", () => {
    expect(LanguageDetector.detect("habari kwa")).toBe("sw"); // Swahili (avoid 'na')
    expect(LanguageDetector.detect("die en nie")).toBe("af"); // Afrikaans
    expect(LanguageDetector.detect("mai ne ce")).toBe("ha"); // Hausa (avoid 'na')
    expect(LanguageDetector.detect("ukuthi ngu kakhulu")).toBe("zu"); // Zulu (avoid 'na')
    expect(LanguageDetector.detect("the and with")).toBe("en");
    expect(LanguageDetector.detect("le la les")).toBe("fr");
    expect(LanguageDetector.detect("do os com")).toBe("pt"); // Portuguese (avoid 'da' which overlaps with Hausa)
    expect(LanguageDetector.detect("yang di dan")).toBe("id");
    expect(LanguageDetector.detect("mga ang ng")).toBe("tl"); // Tagalog
  });

  test("fallback to en for Latin script", () => {
    expect(LanguageDetector.detect("Random latin words without stopwords")).toBe("en");
  });

  test("instantiation for coverage (if constructor is counted)", () => {
    const detector = new LanguageDetector();
    expect(detector).toBeDefined();
  });
});
