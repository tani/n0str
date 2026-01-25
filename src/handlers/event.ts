import { type } from "arktype";
import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import { EventSchema, validateEvent, validateCreatedAt, isEphemeral, matchFilters } from "../nostr";
import { saveEvent, deleteEvents } from "../repository";

const MIN_DIFFICULTY = 0;

/**
 * Handles NIP-01 EVENT messages.
 * Validates, saves, and broadcasts the event to matching subscriptions.
 * Also handles NIP-09 deletion requests and NIP-40 expiration.
 * @param ws - The WebSocket connection of the sender.
 * @param payload - The EVENT message payload (the event).
 * @param clients - The set of all connected WebSocket clients for broadcasting.
 */
export async function handleEvent(
  ws: ServerWebSocket<ClientData>,
  payload: any[],
  clients: Set<ServerWebSocket<ClientData>>,
) {
  const rawEvent = payload[0];
  const event = EventSchema(rawEvent);
  if (event instanceof type.errors) {
    ws.send(JSON.stringify(["OK", rawEvent?.id ?? "unknown", false, "error: malformed event"]));
    return;
  }

  // NIP-40: Check expiration on publish
  const expirationTag = event.tags.find((t) => t[0] === "expiration");
  if (expirationTag && expirationTag[1]) {
    const exp = parseInt(expirationTag[1]);
    if (!isNaN(exp) && exp < Math.floor(Date.now() / 1000)) {
      ws.send(JSON.stringify(["OK", event.id, false, "error: event has expired"]));
      return;
    }
  }

  const result = await validateEvent(event, MIN_DIFFICULTY);
  if (!result.ok) {
    ws.send(JSON.stringify(["OK", event.id, false, result.reason]));
    return;
  }

  // NIP-22: Check created_at limits
  const timeResult = await validateCreatedAt(event.created_at);
  if (!timeResult.ok) {
    ws.send(JSON.stringify(["OK", event.id, false, timeResult.reason]));
    return;
  }

  // NIP-70: Protected Events
  const protectedTag = event.tags.find((t) => t[0] === "-");
  if (protectedTag) {
    if (!ws.data.pubkey) {
      ws.send(
        JSON.stringify([
          "OK",
          event.id,
          false,
          "auth-required: this event may only be published by its author",
        ]),
      );
      ws.send(JSON.stringify(["AUTH", ws.data.challenge]));
      return;
    }
    if (ws.data.pubkey !== event.pubkey) {
      ws.send(
        JSON.stringify([
          "OK",
          event.id,
          false,
          "restricted: this event may only be published by its author",
        ]),
      );
      return;
    }
  }

  if (!isEphemeral(event.kind)) {
    await saveEvent(event);
  }
  ws.send(JSON.stringify(["OK", event.id, true, ""]));

  if (event.kind === 5) {
    const eventIds = event.tags
      .filter((t) => t[0] === "e")
      .flatMap((t) => (typeof t[1] === "string" ? [t[1]] : []));
    const identifiers = event.tags
      .filter((t) => t[0] === "a")
      .flatMap((t) => (typeof t[1] === "string" ? [t[1]] : []));

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
