import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../../src/server.ts";
import { db } from "../../src/repository.ts";
import { generateSecretKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("NIP-50 Search Capability", () => {
  const dbPath = "n0str.test.db";
  let server: any;
  let url: string;

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    await db`DELETE FROM events`;
    await db`DELETE FROM tags`;

    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    if (server) server.stop();
  });

  const sk = generateSecretKey();

  test("Search filters events by content", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const msgQueue: any[] = [];
    let resolveMsg: ((val: any) => void) | null = null;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (resolveMsg) {
        resolveMsg(msg);
        resolveMsg = null;
      } else {
        msgQueue.push(msg);
      }
    };

    const nextMsg = () => {
      if (msgQueue.length > 0) return Promise.resolve(msgQueue.shift());
      return new Promise((resolve) => (resolveMsg = resolve));
    };

    // 1. Publish events
    const events = [
      "I love nostr",
      "Bun is fast",
      "SQLite is lightweight",
      "Implementing NIP-50 search",
    ];

    for (const content of events) {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content,
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", event]));
      const ok = await nextMsg();
      expect(ok[0]).toBe("OK");
      expect(ok[2]).toBe(true);
    }

    // 2. Search for "nostr"
    ws.send(JSON.stringify(["REQ", "search1", { search: "nostr" }]));
    let msg = await nextMsg();
    expect(msg[0]).toBe("EVENT");
    expect(msg[2].content).toBe("I love nostr");
    msg = await nextMsg();
    expect(msg[0]).toBe("EOSE");

    // 3. Search for "fast"
    ws.send(JSON.stringify(["REQ", "search2", { search: "fast" }]));
    msg = await nextMsg();
    expect(msg[0]).toBe("EVENT");
    expect(msg[2].content).toBe("Bun is fast");
    msg = await nextMsg();
    expect(msg[0]).toBe("EOSE");

    // 4. Search for something that doesn't exist
    ws.send(JSON.stringify(["REQ", "search3", { search: "missing" }]));
    msg = await nextMsg();
    expect(msg[0]).toBe("EOSE");

    ws.close();
  });

  test("Search works across 10 major languages", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const msgQueue: any[] = [];
    let resolveMsg: ((val: any) => void) | null = null;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (resolveMsg) {
        resolveMsg(msg);
        resolveMsg = null;
      } else {
        msgQueue.push(msg);
      }
    };

    const nextMsg = () => {
      if (msgQueue.length > 0) return Promise.resolve(msgQueue.shift());
      return new Promise((resolve) => (resolveMsg = resolve));
    };

    const cases = [
      { lang: "en", content: "Full text search works reliably in English.", query: "search" },
      {
        lang: "es",
        content: "La búsqueda de texto completo funciona bien en español.",
        query: "búsqueda",
      },
      {
        lang: "fr",
        content: "La recherche en texte intégral fonctionne en français.",
        query: "recherche",
      },
      {
        lang: "de",
        content: "Die Volltextsuche funktioniert zuverlässig auf Deutsch.",
        query: "Volltextsuche",
      },
      { lang: "it", content: "La ricerca full text funziona bene in italiano.", query: "ricerca" },
      { lang: "pt", content: "A busca de texto completo funciona em português.", query: "busca" },
      {
        lang: "ru",
        content: "Полнотекстовый поиск работает надежно на русском языке.",
        query: "поиск",
      },
      { lang: "ja", content: "日本語の全文検索をテストします。", query: "全文検索" },
      { lang: "zh", content: "我们正在测试全文搜索功能。", query: "搜索" },
      { lang: "ko", content: "한국어 검색 기능을 테스트합니다.", query: "검색" },
    ];

    for (const item of cases) {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: item.content,
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", event]));
      const ok = await nextMsg();
      expect(ok[0]).toBe("OK");
      expect(ok[2]).toBe(true);
    }

    for (const item of cases) {
      ws.send(JSON.stringify(["REQ", `search-${item.lang}`, { search: item.query }]));
      const msg = await nextMsg();
      expect(msg[0]).toBe("EVENT");
      expect(msg[2].content).toBe(item.content);
      const eose = await nextMsg();
      expect(eose[0]).toBe("EOSE");
    }

    ws.close();
  });

  test("Search works across additional major languages", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const msgQueue: any[] = [];
    let resolveMsg: ((val: any) => void) | null = null;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (resolveMsg) {
        resolveMsg(msg);
        resolveMsg = null;
      } else {
        msgQueue.push(msg);
      }
    };

    const nextMsg = () => {
      if (msgQueue.length > 0) return Promise.resolve(msgQueue.shift());
      return new Promise((resolve) => (resolveMsg = resolve));
    };

    const cases = [
      { lang: "ar", content: "يعمل البحث النصي الكامل بشكل موثوق باللغة العربية.", query: "البحث" },
      { lang: "hi", content: "हिंदी में पूर्ण-पाठ खोज अच्छी तरह काम करती है।", query: "खोज" },
      { lang: "th", content: "เรากำลังทดสอบการค้นหาแบบข้อความเต็มภาษาไทย", query: "ค้นหา" },
      { lang: "tr", content: "Türkçe tam metin arama güvenilir şekilde çalışır.", query: "arama" },
      {
        lang: "nl",
        content: "Volledige-tekstreeks werkt goed in het Nederlands.",
        query: "Volledige",
      },
      {
        lang: "id",
        content: "Pencarian teks lengkap bekerja dengan baik dalam Bahasa Indonesia.",
        query: "Pencarian",
      },
    ];

    for (const item of cases) {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: item.content,
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", event]));
      const ok = await nextMsg();
      expect(ok[0]).toBe("OK");
      expect(ok[2]).toBe(true);
    }

    for (const item of cases) {
      ws.send(JSON.stringify(["REQ", `search-${item.lang}`, { search: item.query }]));
      const msg = await nextMsg();
      expect(msg[0]).toBe("EVENT");
      expect(msg[2].content).toBe(item.content);
      const eose = await nextMsg();
      expect(eose[0]).toBe("EOSE");
    }

    ws.close();
  });

  test("Search handles mixed language and punctuation edge cases", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const msgQueue: any[] = [];
    let resolveMsg: ((val: any) => void) | null = null;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (resolveMsg) {
        resolveMsg(msg);
        resolveMsg = null;
      } else {
        msgQueue.push(msg);
      }
    };

    const nextMsg = () => {
      if (msgQueue.length > 0) return Promise.resolve(msgQueue.shift());
      return new Promise((resolve) => (resolveMsg = resolve));
    };

    const cases = [
      { id: "mixed", content: "Hello こんにちは world", query: "こんにちは" },
      { id: "punct", content: "Hello, world! This—works across punctuation.", query: "world" },
      { id: "lines", content: "Line one\nLine two\tLine three", query: "two" },
      { id: "spaces", content: "Multiple     spaces should not break search", query: "spaces" },
    ];

    for (const item of cases) {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: item.content,
        },
        sk,
      );
      ws.send(JSON.stringify(["EVENT", event]));
      const ok = await nextMsg();
      expect(ok[0]).toBe("OK");
      expect(ok[2]).toBe(true);
    }

    for (const item of cases) {
      ws.send(JSON.stringify(["REQ", `edge-${item.id}`, { search: item.query }]));
      const matchedContents: string[] = [];
      while (true) {
        const msg = await nextMsg();
        if (msg[0] === "EOSE") break;
        if (msg[0] === "EVENT") matchedContents.push(msg[2].content);
      }
      expect(matchedContents).toContain(item.content);
    }

    ws.close();
  });
});
