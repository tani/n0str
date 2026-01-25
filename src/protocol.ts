import { z } from "zod";
import type { Event, Filter } from "nostr-tools";
import { verifyEvent } from "nostr-tools";

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

export const ClientMessageSchema = z.union([
  z.tuple([z.literal("EVENT"), EventSchema]),
  z.tuple([z.literal("REQ"), z.string()]).rest(FilterSchema),
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

export function validateEvent(event: any): { ok: boolean; reason?: string } {
  const result = EventSchema.safeParse(event);
  if (!result.success) {
    const error = result.error.issues[0];
    return {
      ok: false,
      reason: `invalid: ${error?.message} at ${error?.path.join(".")}`,
    };
  }

  const validatedEvent = result.data as Event;
  if (!verifyEvent(validatedEvent)) {
    return { ok: false, reason: "invalid: signature verification failed" };
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
