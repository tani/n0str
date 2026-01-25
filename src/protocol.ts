import { z } from "zod";
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

// Zod Schemas
export const EventSchema = z.object({
  id: z.string(),
  pubkey: z.string(),
  created_at: z.number(),
  kind: z.number(),
  content: z.string(),
  tags: z.array(z.array(z.string())),
  sig: z.string(),
});

export const FilterSchema = z
  .object({
    ids: z.array(z.string()).optional(),
    authors: z.array(z.string()).optional(),
    kinds: z.array(z.number()).optional(),
    since: z.number().optional(),
    until: z.number().optional(),
    limit: z.number().optional(),
  })
  .catchall(z.array(z.string())); // Support #... tag filters

export function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
}

export function isEphemeral(kind: number): boolean {
  return kind >= 20000 && kind < 30000;
}

export function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

export const ClientMessageSchema = z.union([
  z.tuple([z.literal("EVENT"), EventSchema]),
  z.tuple([z.literal("REQ"), z.string()]).rest(FilterSchema),
  z.tuple([z.literal("COUNT"), z.string()]).rest(FilterSchema),
  z.tuple([z.literal("AUTH"), EventSchema]),
  z.tuple([z.literal("CLOSE"), z.string()]),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type RelayMessage =
  | ["EVENT", string, Event]
  | ["OK", string, boolean, string]
  | ["EOSE", string]
  | ["NOTICE", string];

export function parseMessage(data: string): ClientMessage | null {
  try {
    const raw = JSON.parse(data);
    const result = ClientMessageSchema.safeParse(raw);
    return result.success ? (result.data as ClientMessage) : null;
  } catch {
    return null;
  }
}

export function validateEvent(
  event: any,
  minDifficulty: number = 0,
): { ok: boolean; reason?: string } {
  const result = EventSchema.safeParse(event);
  if (!result.success) {
    const error = result.error.issues[0];
    return {
      ok: false,
      reason: `invalid: ${error?.message} at ${error?.path.join(".")}`,
    };
  }

  const validatedEvent = result.data as Event;

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
          reason: `pow: target difficulty ${target} is less than ${difficulty}`,
        };
      }
    }
  }

  if (!verifyEvent(validatedEvent)) {
    return { ok: false, reason: "invalid: signature verification failed" };
  }

  return { ok: true };
}

export function validateAuthEvent(
  event: any,
  challenge: string,
  relayUrl: string,
): { ok: boolean; reason?: string } {
  const result = validateEvent(event);
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

export function matchFilter(filter: Filter, event: Event): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since)
    return false;
  if (filter.until !== undefined && event.created_at > filter.until)
    return false;

  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#") && Array.isArray(values)) {
      const tagName = key.substring(1);
      const eventTags = event.tags
        .filter((t) => t[0] === tagName)
        .map((t) => t[1]);
      if (!values.some((v) => typeof v === "string" && eventTags.includes(v)))
        return false;
    }
  }

  return true;
}

export function matchFilters(filters: Filter[], event: Event): boolean {
  return filters.some((f) => matchFilter(f, event));
}
