import { type } from "arktype";
import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import { EventSchema, validateEvent, validateCreatedAt, isEphemeral, matchFilters } from "../nostr";
import { saveEvent, deleteEvents } from "../repository";
import { logger } from "../logger";

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
    void logger.debug`Malformed event received from ${ws.remoteAddress}: ${event.summary}`;
    ws.send(JSON.stringify(["OK", rawEvent?.id ?? "unknown", false, "error: malformed event"]));
    return;
  }

  void logger.trace`Processing event: ${event.id} (kind: ${event.kind}) from ${event.pubkey}`;

  // NIP-40: Check expiration on publish
  const expirationTag = event.tags.find((t) => t[0] === "expiration");
  if (expirationTag && expirationTag[1]) {
    const exp = parseInt(expirationTag[1]);
    if (!isNaN(exp) && exp < Math.floor(Date.now() / 1000)) {
      void logger.debug`Event ${event.id} expired on publish`;
      ws.send(JSON.stringify(["OK", event.id, false, "error: event has expired"]));
      return;
    }
  }

  const result = await validateEvent(event, MIN_DIFFICULTY);
  if (!result.ok) {
    void logger.debug`Event ${event.id} validation failed: ${result.reason}`;
    ws.send(JSON.stringify(["OK", event.id, false, result.reason]));
    return;
  }

  // NIP-22: Check created_at limits
  const timeResult = await validateCreatedAt(event.created_at);
  if (!timeResult.ok) {
    void logger.debug`Event ${event.id} timestamp invalid: ${timeResult.reason}`;
    ws.send(JSON.stringify(["OK", event.id, false, timeResult.reason]));
    return;
  }

  // NIP-70: Protected Events
  const protectedTag = event.tags.find((t) => t[0] === "-");
  if (protectedTag) {
    if (!ws.data.pubkey) {
      void logger.debug`Protected event ${event.id} rejected: auth required`;
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
      void logger.debug`Protected event ${event.id} rejected: pubkey mismatch`;
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
    void logger.trace`Event ${event.id} saved to database`;
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
      void logger.trace`Deleted events based on event ${event.id}`;
    }
  }

  // Broadcast to matching subscriptions
  let broadcastCount = 0;
  for (const client of clients) {
    for (const [subId, filters] of client.data.subscriptions) {
      if (matchFilters(filters, event)) {
        client.send(JSON.stringify(["EVENT", subId, event]));
        broadcastCount++;
      }
    }
  }
  void logger.trace`Event ${event.id} broadcasted to ${broadcastCount} subscriptions`;
}
