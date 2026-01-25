import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types.ts";
import { queryEventsForSync } from "../repository.ts";
import { Negentropy, NegentropyStorageVector } from "../negentropy.js";

export async function handleNegOpen(ws: ServerWebSocket<ClientData>, args: any[]) {
  const [subId, filter, initialMessage] = args;

  if (ws.data.negSubscriptions.has(subId)) {
    ws.data.negSubscriptions.delete(subId);
  }

  try {
    const events = await queryEventsForSync(filter);
    const storage = new NegentropyStorageVector();

    for (const event of events) {
      storage.insert(event.created_at, event.id);
    }
    storage.seal();

    const neg = new Negentropy(storage, 1024 * 1024); // 1MB limit?
    const result = await neg.reconcile(initialMessage);
    const outputMessage = result[0];

    // Store both neg and storage if needed, but the wrapper just holds storage.
    // Actually we just need to store 'neg' instance which holds 'storage'.
    ws.data.negSubscriptions.set(subId, neg);

    if (outputMessage) {
      ws.send(JSON.stringify(["NEG-MSG", subId, outputMessage]));
    } else {
      // If null, it means sync is done on our side?
      // Or wait, reconcile returns [output, haveIds, needIds]
      // If output is null, it means we have nothing more to say?
      // Protocol says "If client wishes to continue... sends NEG-MSG".
      // Use empty string? No, result[0] is hex string or null.
      // If null, maybe we shouldn't send NEG-MSG?
      // But usually we send at least one response.
      // Let's assume outputMessage is non-null if conversation continues.
      ws.send(JSON.stringify(["NEG-MSG", subId, outputMessage ?? ""]));
    }
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
    const result = await neg.reconcile(message);
    const outputMessage = result[0];
    if (outputMessage) {
      ws.send(JSON.stringify(["NEG-MSG", subId, outputMessage]));
    }
  } catch (err: any) {
    ws.send(JSON.stringify(["NEG-ERR", subId, "error: " + err.message]));
  }
}

export function handleNegClose(ws: ServerWebSocket<ClientData>, args: any[]) {
  const [subId] = args;
  ws.data.negSubscriptions.delete(subId);
}
