import {
  expect,
  test,
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { relay } from "../src/relay.ts";

describe("NIP-11 Relay Information Document", () => {
  let server: any;
  let url: string;

  beforeEach(() => {
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  test("NIP-11 Information Document", async () => {
    const res = await fetch(url.replace("ws://", "http://"), {
      headers: { Accept: "application/nostr+json" },
    });
    expect(res.status).toBe(200);
    const info = (await res.json()) as any;
    expect(info.name).toBe("Nostra Relay");
    [
      1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 22, 23, 25, 28, 33,
      40, 42, 44, 45, 50, 51, 57, 65, 78,
    ].forEach((nip) => {
      expect(info.supported_nips).toContain(nip);
    });
  });

  test("Default HTTP Response", async () => {
    const res = await fetch(url.replace("ws://", "http://"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Nostra Relay");
  });
});
