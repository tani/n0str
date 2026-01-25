import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { relay } from "../src/server.ts";
import { relayInfo } from "../src/config.ts";

describe("Welcome Page", () => {
  let server: any;
  let url: string;

  beforeEach(() => {
    // Start server on random port
    server = Bun.serve({ ...relay, port: 0 });
    url = `http://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  test("returns welcome page HTML", async () => {
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");

    const text = await res.text();
    expect(text).toContain(`<!DOCTYPE html>`);
    expect(text).toContain(`<title>${relayInfo.name}</title>`);
    expect(text).toContain(`<h1>${relayInfo.name}</h1>`);
    expect(text).toContain(relayInfo.description);
    expect(text).toContain(`Supported NIPs`);
    relayInfo.supported_nips.forEach(nip => {
        expect(text).toContain(nip.toString());
    });
    expect(text).toContain(relayInfo.software);
    expect(text).toContain(relayInfo.version);
    expect(text).toContain(relayInfo.contact);
    expect(text).toContain(relayInfo.pubkey);
  });
});
