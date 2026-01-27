export class LanguageDetector {
  static SCRIPTS: { lang: string; reg: RegExp }[] = [
    // --- 1. Unique Scripts ---
    { lang: "am", reg: /\p{sc=Ethiopic}/u }, // Ethiopia (Amharic)
    { lang: "ar", reg: /\p{sc=Arabic}/u }, // North African countries (Arabic)
    { lang: "ja", reg: /\p{sc=Hiragana}/u }, // (Existing Asian/European scripts)
    { lang: "ko", reg: /\p{sc=Hangul}/u },
    { lang: "zh", reg: /\p{sc=Han}/u },
    { lang: "hi", reg: /\p{sc=Devanagari}/u },
    { lang: "ru", reg: /\p{sc=Cyrillic}/u },

    // --- 2. Latin-based African languages (Special characters) ---
    // Yoruba/Igbo (Nigeria, etc.): Characteristic under-dots (ẹ, ọ, ṣ)
    { lang: "yo", reg: /[ẹọṣ]/i },
    { lang: "ig", reg: /[ịọụ]/i },
    // Vietnamese (Existing)
    { lang: "vi", reg: /[àáảạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i },
  ];

  static UNIQUE_CHARS: { lang: string; reg: RegExp }[] = [
    // Europe / Central Asia (Existing)
    { lang: "de", reg: /[ß]/i },
    { lang: "es", reg: /[ñ¿¡]/i },
    { lang: "pt", reg: /[ãõ]/i },
    { lang: "tr", reg: /[ğıİşçöü]/i },
    { lang: "uz", reg: /(o'|g')/i },
  ];

  static STOPWORDS: Record<string, RegExp> = {
    // --- 3. African Languages Frequent Words ---
    // Swahili (Largest language in East Africa)
    sw: /\b(na|ya|wa|kwa|katika|ni|za)\b/i,
    // Afrikaans (South Africa: derived from Dutch but distinct)
    af: /\b(die|en|nie|van|het|is|baie)\b/i,
    // Hausa (West Africa: Nigeria, etc.)
    ha: /\b(da|na|ta|mai|ne|ce)\b/i,
    // Zulu (South Africa: characteristic prefixes, but detected via frequent words)
    zu: /\b(ukuthi|ngu|na|kakhulu)\b/i,

    // Existing major languages
    en: /\b(the|and|with|this)\b/i,
    fr: /\b(le|la|les|est|un|une)\b/i, // Important as official language in West/Central Africa
    pt: /\b(do|da|os|as|com)\b/i, // Angola, Mozambique, etc.
    id: /\b(yang|di|dan|ini)\b/i,
    tl: /\b(mga|ang|ng|sa|po)\b/i,
  };

  static cleanText(text: string): string {
    return text
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

    for (const { lang, reg } of this.SCRIPTS) if (reg.test(cleaned)) return lang;
    for (const { lang, reg } of this.UNIQUE_CHARS) if (reg.test(cleaned)) return lang;
    for (const [lang, reg] of Object.entries(this.STOPWORDS)) if (reg.test(cleaned)) return lang;

    return /\p{sc=Latin}/u.test(cleaned) ? "en" : "unknown";
  }
}
