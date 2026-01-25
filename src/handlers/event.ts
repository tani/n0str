import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import {
  EventSchema,
  validateEvent,
  validateCreatedAt,
  isEphemeral,
  matchFilters,
} from "../protocol";
import { saveEvent, deleteEvents } from "../db";

const MIN_DIFFICULTY = 0;

export async function handleEvent(
  ws: ServerWebSocket<ClientData>,
  payload: any[],
  clients: Set<ServerWebSocket<ClientData>>,
) {
  const rawEvent = payload[0];
  const eventParse = EventSchema.safeParse(rawEvent);
  if (!eventParse.success) {
    ws.send(JSON.stringify(["OK", rawEvent?.id ?? "unknown", false, "error: malformed event"]));
    return;
  }
  const event = eventParse.data;

  // NIP-40: Check expiration on publish
  const expirationTag = event.tags.find((t) => t[0] === "expiration");
  if (expirationTag && expirationTag[1]) {
    const exp = parseInt(expirationTag[1]);
    if (!isNaN(exp) && exp < Math.floor(Date.now() / 1000)) {
      ws.send(JSON.stringify(["OK", event.id, false, "error: event has expired"]));
      return;
    }
  }

  const result = validateEvent(event, MIN_DIFFICULTY);
  if (!result.ok) {
    ws.send(JSON.stringify(["OK", event.id, false, result.reason]));
    return;
  }

  // NIP-22: Check created_at limits
  const timeResult = validateCreatedAt(event.created_at);
  if (!timeResult.ok) {
    ws.send(JSON.stringify(["OK", event.id, false, timeResult.reason]));
    return;
  }

  if (!isEphemeral(event.kind)) {
    await saveEvent(event);
  }
  ws.send(JSON.stringify(["OK", event.id, true, ""]));

  // NIP-09: Handle Deletion Request (kind 5)
  if (event.kind === 5) {
    const eventIds = event.tags
      .filter((t) => t[0] === "e")
      .map((t) => t[1])
      .filter((id): id is string => typeof id === "string");

    const identifiers = event.tags
      .filter((t) => t[0] === "a")
      .map((t) => t[1])
      .filter((id): id is string => typeof id === "string");

    if (eventIds.length > 0 || identifiers.length > 0) {
      await deleteEvents(event.pubkey, eventIds, identifiers, event.created_at);
    }
  }

  // Broadcast to matching subscriptions
  for (const client of clients) {
    for (const [subId, filters] of client.data.subscriptions) {
      if (matchFilters(filters, event)) {
        client.send(JSON.stringify(["EVENT", subId, event]));
      }
    }
  }
}
