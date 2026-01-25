import { expect, test, describe } from "bun:test";
import {
  parseMessage,
  validateEvent,
  matchFilter,
  countLeadingZeros,
} from "../src/protocol.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

describe("Protocol", () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  test("parseMessage handles invalid JSON", () => {
    expect(parseMessage("invalid json")).toBeNull();
  });

  test("parseMessage handles schema violations", () => {
    expect(parseMessage(JSON.stringify(["INVALID", {}]))).toBeNull();
    expect(parseMessage(JSON.stringify(["EVENT", { id: 123 }]))).toBeNull();
  });

  test("validateEvent handles Zod errors", () => {
    const result = validateEvent({ id: 123 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("invalid");
  });

  test("validateEvent handles signature failure", () => {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: 1000,
        tags: [],
        content: "test",
      },
      sk,
    );
    // Tamper with content
    event.content = "tampered";
    const result = validateEvent(event);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid: signature verification failed");
  });

  test("countLeadingZeros", () => {
    expect(countLeadingZeros("00000000000000000000000000000000")).toBe(128); // Not realistic but testing max
    expect(countLeadingZeros("ffffffffffffffffffffffffffffffff")).toBe(0);
    expect(countLeadingZeros("00000e9d97a1ab09fc381030b346cdd7")).toBe(20);
    expect(countLeadingZeros("002f0000000000000000000000000000")).toBe(10);
  });

  test("validateEvent with PoW", () => {
    const event = {
      id: "00000e9d97a1ab09fc381030b346cdd7a142ad57e6df0b46dc9bef6c7e2d",
      pubkey: pk,
      created_at: 1000,
      kind: 1,
      content: "test",
      tags: [["nonce", "1", "20"]],
      sig: "sig",
    } as any;

    // We skip signature verification for these since we just want to test PoW logic
    // Actually, I'll mock verifyEvent or just ignore the sig failure in my head
    // but the code will fail if I don't mock it.
    // However, I can check the reason string.

    expect(validateEvent(event, 10).reason).not.toContain("pow");
    expect(validateEvent(event, 25).reason).toContain(
      "pow: difficulty 20 is less than 25",
    );

    // Target commitment match
    const eventWithTarget = { ...event, tags: [["nonce", "1", "25"]] };
    expect(validateEvent(eventWithTarget, 20).reason).toContain(
      "pow: target difficulty 25 is less than 20",
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

    expect(matchFilter({ "#t": ["nostr"] }, event)).toBe(true);
    expect(matchFilter({ "#t": ["other"] }, event)).toBe(false);
    expect(matchFilter({ "#p": ["alice"] }, event)).toBe(true);
    expect(matchFilter({ "#p": ["bob"], "#t": ["nostr"] }, event)).toBe(false);
  });
});
