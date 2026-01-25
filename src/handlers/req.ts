import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import type { Filter } from "nostr-tools";
import { queryEvents } from "../repository";
import { relayInfo } from "../config";
import { logger } from "../logger";

/**
 * Handles NIP-01 REQ messages.
 * Registers a subscription, fetches historical events, and sends them to the client.
 * @param ws - The WebSocket connection.
 * @param payload - The REQ message payload (subscription ID and filters).
 */
export async function handleReq(ws: ServerWebSocket<ClientData>, payload: any[]) {
  const [subId, ...filters] = payload as [string, ...Filter[]];

  void logger.trace`REQ received for subId: ${subId} with ${filters.length} filters`;

  if (ws.data.subscriptions.size >= relayInfo.limitation.max_subscriptions) {
    void logger.debug`Max subscriptions reached for ${ws.remoteAddress} (subId: ${subId})`;
    ws.send(JSON.stringify(["CLOSED", subId, "error: max subscriptions reached"]));
    return;
  }

  ws.data.subscriptions.set(subId, filters);

  // Send historical events
  const sentEventIds = new Set<string>();
  let eventCount = 0;
  for (const filter of filters) {
    const events = await queryEvents(filter);
    for (const event of events) {
      if (!sentEventIds.has(event.id)) {
        ws.send(JSON.stringify(["EVENT", subId, event]));
        sentEventIds.add(event.id);
        eventCount++;
      }
    }
  }
  void logger.trace`Sent ${eventCount} stored events for subId: ${subId}`;
  ws.send(JSON.stringify(["EOSE", subId]));
}
