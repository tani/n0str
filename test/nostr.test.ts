import { engines } from "./utils/engines.ts";
import { expect, test, describe, beforeAll } from "bun:test";
import {
  validateEvent,
  matchFilters,
  countLeadingZeros,
  validateAuthEvent,
  ClientMessageSchema,
} from "../src/nostr.ts";
import { initRepository, getRepository } from "../src/repository.ts";
import { relayService } from "../src/server.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import { type } from "arktype";

describe.each(engines)("Engine: %s > Protocol", () => {
  beforeAll(async () => {
    await initRepository(":memory:");
    relayService.setRepository(getRepository());
  });

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  test("ClientMessageSchema handles invalid JSON", () => {
    expect(ClientMessageSchema("invalid json") instanceof type.errors).toBe(true);
  });

  test("ClientMessageSchema handles schema violations", () => {
    expect(ClientMessageSchema(JSON.stringify(["INVALID", {}])) instanceof type.errors).toBe(true);
    expect(ClientMessageSchema(JSON.stringify(["EVENT", { id: 123 }])) instanceof type.errors).toBe(
      true,
    );
  });

  test("validateEvent handles ArkType errors", async () => {
    const result = await validateEvent({ id: 123 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("invalid");
  });

  test("validateEvent handles signature failure", async () => {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: 1000,
        tags: [],
        content: "test",
      },
      sk,
    );
    // Tamper with content and strip symbols to force re-verification
    const tampered = JSON.parse(JSON.stringify(event));
    tampered.content = "tampered";
    const result = await validateEvent(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid: signature verification failed");
  });

  test("countLeadingZeros", () => {
    expect(countLeadingZeros("00000000000000000000000000000000")).toBe(128); // Not realistic but testing max
    expect(countLeadingZeros("ffffffffffffffffffffffffffffffff")).toBe(0);
    expect(countLeadingZeros("00000e9d97a1ab09fc381030b346cdd7")).toBe(20);
    expect(countLeadingZeros("002f0000000000000000000000000000")).toBe(10);
  });

  test("validateEvent with PoW", async () => {
    const event = {
      id: "00000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d",
      pubkey: pk,
      created_at: 1000,
      kind: 1,
      content: "test",
      tags: [["nonce", "1", "20"]],
      sig: "a".repeat(128),
    } as any;

    expect((await validateEvent(event, 10)).reason).not.toContain("pow");
    expect((await validateEvent(event, 25)).reason).toContain("pow: difficulty 20 is less than 25");

    // Target commitment match
    const eventWithTarget = { ...event, tags: [["nonce", "1", "25"]] };
    expect((await validateEvent(eventWithTarget, 20)).reason).toContain(
      "pow: actual difficulty 20 is less than target difficulty 25",
    );
  });

  test("matchFilter handles complex tag filters", () => {
    const event = {
      id: "1",
      pubkey: pk,
      created_at: 1000,
      kind: 1,
      content: "test",
      tags: [
        ["t", "nostr"],
        ["p", "alice"],
      ],
      sig: "sig",
    } as any;

    expect(matchFilters([{ "#t": ["nostr"] }], event)).toBe(true);
    expect(matchFilters([{ "#t": ["other"] }], event)).toBe(false);
    expect(matchFilters([{ "#p": ["alice"] }], event)).toBe(true);
    expect(matchFilters([{ "#p": ["bob"], "#t": ["nostr"] }], event)).toBe(false);
  });

  describe("validateAuthEvent branches", () => {
    test("invalid signature", async () => {
      const event = finalizeEvent(
        {
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "",
        },
        sk,
      );
      const tampered = JSON.parse(JSON.stringify(event));
      tampered.sig = "0".repeat(128);
      const res = await validateAuthEvent(tampered, "challenge", "ws://localhost");
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("signature verification failed");
    });

    test("wrong kind", async () => {
      const event = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "",
        },
        sk,
      );
      const res = await validateAuthEvent(event, "challenge", "ws://localhost");
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("invalid: kind must be 22242");
    });

    test("created_at too far", async () => {
      const event = finalizeEvent(
        {
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000) - 1000,
          tags: [],
          content: "",
        },
        sk,
      );
      const res = await validateAuthEvent(event, "challenge", "ws://localhost");
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("invalid: created_at is too far from current time");
    });

    test("missing relay tag", async () => {
      const event = finalizeEvent(
        {
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["challenge", "challenge"]],
          content: "",
        },
        sk,
      );
      const res = await validateAuthEvent(event, "challenge", "ws://localhost");
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("invalid: missing relay tag");
    });
  });
});
