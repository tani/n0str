import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import type { Filter } from "nostr-tools";
import { queryEvents } from "../repository";
import { relayInfo } from "../config";

export async function handleReq(ws: ServerWebSocket<ClientData>, payload: any[]) {
  const [subId, ...filters] = payload as [string, ...Filter[]];

  if (ws.data.subscriptions.size >= relayInfo.limitation.max_subscriptions) {
    ws.send(JSON.stringify(["CLOSED", subId, "error: max subscriptions reached"]));
    return;
  }

  ws.data.subscriptions.set(subId, filters);

  // Send historical events
  const sentEventIds = new Set<string>();
  for (const filter of filters) {
    const events = await queryEvents(filter);
    for (const event of events) {
      if (!sentEventIds.has(event.id)) {
        ws.send(JSON.stringify(["EVENT", subId, event]));
        sentEventIds.add(event.id);
      }
    }
  }
  ws.send(JSON.stringify(["EOSE", subId]));
}
