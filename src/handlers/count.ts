import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import type { Filter } from "nostr-tools";
import { countEvents } from "../repository";

/**
 * Handles NIP-45 COUNT messages.
 * @param ws - The WebSocket connection.
 * @param payload - The COUNT message payload (subscription ID and filters).
 */
export async function handleCount(ws: ServerWebSocket<ClientData>, payload: any[]) {
  const [subId, ...filters] = payload as [string, ...Filter[]];
  const count = await countEvents(filters);
  ws.send(JSON.stringify(["COUNT", subId, { count }]));
}
