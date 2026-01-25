import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import type { Event } from "nostr-tools";
import { validateAuthEvent } from "../nostr";
import { logger } from "../logger";

/**
 * Handles NIP-42 AUTH messages.
 * @param ws - The WebSocket connection.
 * @param payload - The AUTH message payload (the event).
 */
export async function handleAuth(ws: ServerWebSocket<ClientData>, payload: any[]) {
  const authEvent = payload[0] as Event;
  void logger.trace`AUTH attempt from ${authEvent.pubkey}`;

  const result = await validateAuthEvent(authEvent, ws.data.challenge, ws.data.relayUrl);

  if (!result.ok) {
    void logger.debug`AUTH failed for ${authEvent.pubkey}: ${result.reason}`;
    ws.send(JSON.stringify(["OK", authEvent.id, false, result.reason]));
    return;
  }

  ws.data.pubkey = authEvent.pubkey;
  void logger.info`Client authenticated: ${authEvent.pubkey}`;
  ws.send(JSON.stringify(["OK", authEvent.id, true, ""]));
}
