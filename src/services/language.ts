/**
 * LanguageDetector
 * Optimized for full-text search engine pipelines.
 * Prioritizes speed (Boolean logic) and specific script detection (CJK).
 */
export class LanguageDetector {
  // --- 1. Unique Scripts (High Confidence) ---
  // Regexes are pre-compiled for performance.
  static readonly SCRIPTS = [
    { lang: "ja", reg: /[\p{sc=Hiragana}\p{sc=Katakana}]/u }, // Hiragana/Katakana -> Japanese (Highest Priority in CJK)
    { lang: "ko", reg: /\p{sc=Hangul}/u }, // Hangul -> Korean
    { lang: "zh", reg: /\p{sc=Han}/u }, // Han -> Chinese (only if no Hiragana/Katakana/Hangul)
    { lang: "am", reg: /\p{sc=Ethiopic}/u }, // Ethiopia (Amharic)
    { lang: "ar", reg: /\p{sc=Arabic}/u }, // Arabic
    { lang: "hi", reg: /\p{sc=Devanagari}/u }, // Hindi
    { lang: "ru", reg: /\p{sc=Cyrillic}/u }, // Russian
    // Vietnamese (Unique tone marks, high confidence - effectively a script check)
    // Excludes common accents used in European languages (à, á, è, é, ì, í, ò, ó, ù, ú, ý)
    // Excludes chars shared with Yoruba/Igbo (ẹ, ọ, ị, ụ) and Portuguese (ã, õ) to avoid false positives.
    // Includes:
    // - Breve: ă, ằ, ắ, ẳ, ẵ, ặ
    // - Circumflex + Tone: ầ, ấ, ẩ, ẫ, ậ, ề, ế, ể, ễ, ệ, ồ, ố, ổ, ỗ, ộ
    // - Horn: ư, ừ, ứ, ử, ữ, ự, ơ, ờ, ớ, ở, ỡ, ợ
    // - Hook above: ả, ẻ, ỉ, ỏ, ủ, ỷ
    // - Tilde (other than a/o): ẽ, ĩ, ũ, ỹ
    // - Dot below (other than e/o/i/u): ạ
    // - D bar: đ
    { lang: "vi", reg: /[ăằắẳẵặâầấẩẫậêềếểễệôồốổỗộưừứửữựơờớởỡợđảẻỉỏủỷẽĩũỹạ]/i },
  ];

  // --- 2. Latin-based Unique Characters (High Confidence) ---
  static readonly UNIQUE_CHARS = [
    // Yoruba/Igbo (Nigeria, etc.): Characteristic under-dots (ẹ, ọ, ṣ)
    { lang: "yo", reg: /[ẹọṣ]/i },
    { lang: "ig", reg: /[ịọụ]/i },
    // Europe / Central Asia
    { lang: "de", reg: /[ß]/i },
    { lang: "es", reg: /[ñ¿¡]/i },
    { lang: "pt", reg: /[ãõ]/i },
    { lang: "tr", reg: /[ğıİşçöü]/i },
    { lang: "uz", reg: /(o'|g')/i },
  ];

  // --- 3. Stopwords (Fallback) ---
  static readonly STOPWORDS: Record<string, RegExp> = {
    // African Languages
    sw: /\b(na|ya|wa|kwa|katika|ni|za)\b/i,
    af: /\b(die|en|nie|van|het|is|baie)\b/i,
    ha: /\b(da|na|ta|mai|ne|ce)\b/i,
    zu: /\b(ukuthi|ngu|na|kakhulu)\b/i,

    // Existing major languages
    en: /\b(the|and|with|this)\b/i,
    fr: /\b(le|la|les|est|un|une)\b/i,
    pt: /\b(do|da|os|as|com)\b/i,
    id: /\b(yang|di|dan|ini)\b/i,
    tl: /\b(mga|ang|ng|sa|po)\b/i,
  };

  // --- 4. Fallback Script ---
  static readonly LATIN = /\p{sc=Latin}/u;

  constructor() {}

  static cleanText(text: string): string {
    return text
      .normalize("NFC")
      .replace(/https?:\/\/\S+|www\.\S+/gi, "")
      .replace(/@\S+|#\S+/g, "")
      .replace(/\d+/g, "")
      .replace(/[^\p{L}\p{M}\s']/gu, "")
      .trim();
  }

  static detect(text: string): string {
    if (!text) return "unknown";
    const cleaned = this.cleanText(text);
    if (!cleaned) return "unknown";

    // 1. Check Scripts (Immediate Return)
    for (const { lang, reg } of this.SCRIPTS) {
      if (reg.test(cleaned)) return lang;
    }

    // 2. Check Unique Characters (Immediate Return)
    for (const { lang, reg } of this.UNIQUE_CHARS) {
      if (reg.test(cleaned)) return lang;
    }

    // 3. Check Stopwords (Fallback)
    for (const [lang, reg] of Object.entries(this.STOPWORDS)) {
      if (reg.test(cleaned)) return lang;
    }

    // 4. Final Fallback
    if (this.LATIN.test(cleaned)) {
      return "en";
    }

    return "unknown";
  }
}
