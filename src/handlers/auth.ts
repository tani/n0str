import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import type { Event } from "nostr-tools";
import { validateAuthEvent } from "../nostr";

export async function handleAuth(ws: ServerWebSocket<ClientData>, payload: any[]) {
  const authEvent = payload[0] as Event;
  const result = await validateAuthEvent(authEvent, ws.data.challenge, ws.data.relayUrl);

  if (!result.ok) {
    ws.send(JSON.stringify(["OK", authEvent.id, false, result.reason]));
    return;
  }
  ws.data.pubkey = authEvent.pubkey;
  ws.send(JSON.stringify(["OK", authEvent.id, true, ""]));
}
