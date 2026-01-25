import { type } from "arktype";
import type { Event, Filter } from "nostr-tools";
import { verifyEvent } from "nostr-tools";

export function countLeadingZeros(hex: string): number {
  let count = 0;
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i]!, 16);
    if (nibble === 0) {
      count += 4;
    } else {
      count += Math.clz32(nibble) - 28;
      break;
    }
  }
  return count;
}

// ArkType Schemas
export const EventSchema = type({
  id: "string",
  pubkey: "string==64",
  created_at: "number",
  kind: "number",
  content: "string",
  tags: "string[][]",
  sig: "string==128",
});

export const FilterSchema = type({
  "ids?": "string[]",
  "authors?": "string[]",
  "kinds?": "number[]",
  "since?": "number",
  "until?": "number",
  "limit?": "number",
  "search?": "string",
  "[string]": "unknown", // Support #... tag filters loosely
});

export function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
}

export function isEphemeral(kind: number): boolean {
  return kind >= 20000 && kind < 30000;
}

export function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

const $ = type.scope({
  Event: EventSchema,
  Filter: FilterSchema,
  ReqMsg: ["'REQ'", "string", "...", "Filter[]"],
  CountMsg: ["'COUNT'", "string", "...", "Filter[]"],
  EventMsg: ["'EVENT'", "Event"],
  AuthMsg: ["'AUTH'", "Event"],
  CloseMsg: ["'CLOSE'", "string"],
  ClientMessage: "EventMsg | ReqMsg | CountMsg | AuthMsg | CloseMsg",
});

export const ClientMessageSchema = type("string.json.parse").to($.type("ClientMessage"));

export type ClientMessage = typeof ClientMessageSchema.infer;

export type RelayMessage =
  | ["EVENT", string, Event]
  | ["OK", string, boolean, string]
  | ["EOSE", string]
  | ["NOTICE", string];

export function parseMessage(data: string): ClientMessage | null {
  const out = ClientMessageSchema(data);
  return out instanceof type.errors ? null : out;
}

export async function validateEvent(
  event: any,
  minDifficulty: number = 0,
): Promise<{ ok: boolean; reason?: string }> {
  const out = EventSchema(event);
  if (out instanceof type.errors) {
    return {
      ok: false,
      reason: `invalid: ${out.summary}`,
    };
  }

  const validatedEvent = out as Event;

  // NIP-13: check difficulty
  if (minDifficulty > 0) {
    const difficulty = countLeadingZeros(validatedEvent.id);
    if (difficulty < minDifficulty) {
      return {
        ok: false,
        reason: `pow: difficulty ${difficulty} is less than ${minDifficulty}`,
      };
    }

    const nonceTag = validatedEvent.tags.find((t) => t[0] === "nonce");
    if (nonceTag && nonceTag[2]) {
      const target = parseInt(nonceTag[2]);
      if (!isNaN(target) && target > difficulty) {
        return {
          ok: false,
          reason: `pow: actual difficulty ${difficulty} is less than target difficulty ${target}`,
        };
      }
    }
  }

  const isSigValid = await verifyEvent(validatedEvent);
  if (!isSigValid) {
    return { ok: false, reason: "invalid: signature verification failed" };
  }

  return { ok: true };
}

export async function validateAuthEvent(
  event: any,
  challenge: string,
  relayUrl: string,
): Promise<{ ok: boolean; reason?: string }> {
  const result = await validateEvent(event);
  if (!result.ok) return result;

  const authEvent = event as Event;

  if (authEvent.kind !== 22242) {
    return { ok: false, reason: "invalid: kind must be 22242" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(authEvent.created_at - now) > 600) {
    return {
      ok: false,
      reason: "invalid: created_at is too far from current time",
    };
  }

  const challengeTag = authEvent.tags.find((t) => t[0] === "challenge")?.[1];
  if (challengeTag !== challenge) {
    return { ok: false, reason: "invalid: challenge mismatch" };
  }

  const relayTag = authEvent.tags.find((t) => t[0] === "relay")?.[1];
  if (!relayTag) {
    return { ok: false, reason: "invalid: missing relay tag" };
  }

  // Basic URL comparison (ignoring trailing slash and protocol case)
  const normalize = (u: string) => u.toLowerCase().replace(/\/$/, "");
  if (normalize(relayTag) !== normalize(relayUrl)) {
    return {
      ok: false,
      reason: `invalid: relay tag mismatch (expected ${relayUrl}, got ${relayTag})`,
    };
  }

  return { ok: true };
}

export async function validateCreatedAt(createdAt: number): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 60 * 60 * 24 * 365;
  const oneHourAhead = now + 60 * 60;

  if (createdAt < oneYearAgo) {
    return { ok: false, reason: "error: event is too old" };
  }
  if (createdAt > oneHourAhead) {
    return { ok: false, reason: "error: event is too far in the future" };
  }
  return { ok: true };
}

export function matchFilter(filter: Filter, event: Event): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;

  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#") && Array.isArray(values)) {
      const tagName = key.substring(1);
      const eventTags = event.tags.filter((t) => t[0] === tagName).map((t) => t[1]);
      if (!values.some((v) => typeof v === "string" && eventTags.includes(v))) return false;
    }
  }

  return true;
}

export function matchFilters(filters: Filter[], event: Event): boolean {
  return filters.some((f) => matchFilter(f, event));
}
