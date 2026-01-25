import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import type { Filter } from "nostr-tools";
import { countEvents } from "../repository";

export async function handleCount(ws: ServerWebSocket<ClientData>, payload: any[]) {
  const [subId, ...filters] = payload as [string, ...Filter[]];
  const count = await countEvents(filters);
  ws.send(JSON.stringify(["COUNT", subId, { count }]));
}
