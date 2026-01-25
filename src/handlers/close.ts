import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import { logger } from "../logger";

/**
 * Handles NIP-01 CLOSE messages.
 * @param ws - The WebSocket connection.
 * @param payload - The CLOSE message payload (subscription ID).
 */
export function handleClose(ws: ServerWebSocket<ClientData>, payload: any[]) {
  const subId = payload[0] as string;
  ws.data.subscriptions.delete(subId);
  void logger.trace`Subscription closed: ${subId}`;
}
