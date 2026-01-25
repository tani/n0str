import { expect, test, describe } from "bun:test";
import { parseMessage, validateEvent, matchFilter } from "../src/protocol.ts";
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
