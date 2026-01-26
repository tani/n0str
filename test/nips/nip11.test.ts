import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { createTestEnv } from "../utils/test_helper.ts";

describe("NIP-11 Relay Information Document", () => {
  let server: any;
  let url: string;
  let repository: any;
  let relayService: any;
  let db: any;

  beforeEach(async () => {
    const env = await createTestEnv();
    server = env.server;
    url = env.url;
    repository = env.repository;
    relayService = env.relayService;
    db = env.db;
  });

  afterEach(async () => {
    server.stop();
    await repository.close();
  });

  test("NIP-11 Information Document", async () => {
    const res = await fetch(url.replace("ws://", "http://"), {
      headers: { Accept: "application/nostr+json" },
    });
    expect(res.status).toBe(200);
    const info = (await res.json()) as any;
    expect(info.name).toBe("n0str Relay");
    [
      1, 2, 3, 5, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 22, 23, 25, 28, 33, 40, 42, 44, 45, 50, 51,
      57, 65, 70, 77, 78,
    ].forEach((nip) => {
      expect(info.supported_nips).toContain(nip);
    });
  });

  test("Default HTTP Response", async () => {
    const res = await fetch(url.replace("ws://", "http://"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("n0str Relay");
  });
});
