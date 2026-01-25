import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";

export function handleClose(ws: ServerWebSocket<ClientData>, payload: unknown[]) {
  const subId = payload[0] as string;
  ws.data.subscriptions.delete(subId);
}
