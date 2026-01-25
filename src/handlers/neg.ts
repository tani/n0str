import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types.ts"; // Note the .ts extension usage if configured, but normally import from "../types"
import { queryEventsForSync } from "../repository.ts";
import { Negentropy } from "negentropy";

export async function handleNegOpen(ws: ServerWebSocket<ClientData>, args: any[]) {
  const [subId, filter, initialMessage] = args;

  // NIP-77: "If a NEG-OPEN is issued for a currently open subscription ID, the existing subscription is first closed."
  if (ws.data.negSubscriptions.has(subId)) {
    ws.data.negSubscriptions.delete(subId);
  }

  try {
    const events = await queryEventsForSync(filter);
    const neg = new Negentropy(32); // ID size 32 bytes

    for (const event of events) {
      neg.addItem(event.created_at, event.id);
    }
    neg.seal();

    const result = neg.reconcile(initialMessage);
    const outputMessage = result[0]; // reconcile returns [output, haveIds, needIds]

    ws.data.negSubscriptions.set(subId, neg);
    ws.send(JSON.stringify(["NEG-MSG", subId, outputMessage]));
  } catch (err: any) {
    ws.send(JSON.stringify(["NEG-ERR", subId, "error: " + err.message]));
  }
}

export async function handleNegMsg(ws: ServerWebSocket<ClientData>, args: any[]) {
  const [subId, message] = args;
  const neg = ws.data.negSubscriptions.get(subId);

  if (!neg) {
    ws.send(JSON.stringify(["NEG-ERR", subId, "closed: subscription not found"]));
    return;
  }

  try {
    const result = neg.reconcile(message);
    const outputMessage = result[0];
    ws.send(JSON.stringify(["NEG-MSG", subId, outputMessage]));
  } catch (err: any) {
    ws.send(JSON.stringify(["NEG-ERR", subId, "error: " + err.message]));
  }
}

export function handleNegClose(ws: ServerWebSocket<ClientData>, args: any[]) {
  const [subId] = args;
  ws.data.negSubscriptions.delete(subId);
}
