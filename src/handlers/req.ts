import { Effect } from "effect";
import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import type { Filter } from "nostr-tools";
import { queryEvents } from "../db";
import { relayInfo } from "../config";

export function handleReq(ws: ServerWebSocket<ClientData>, payload: unknown[]) {
  return Effect.gen(function* () {
    const [subId, ...filters] = payload as [string, ...Filter[]];

    if (ws.data.subscriptions.size >= relayInfo.limitation.max_subscriptions) {
       yield* Effect.sync(() => ws.send(JSON.stringify(["CLOSED", subId, "error: max subscriptions reached"])));
       return;
    }

    yield* Effect.sync(() => ws.data.subscriptions.set(subId, filters));

    // Send historical events
    const sentEventIds = new Set<string>();
    for (const filter of filters) {
      const events = yield* Effect.tryPromise(() => queryEvents(filter));
      for (const event of events) {
        if (!sentEventIds.has(event.id)) {
          yield* Effect.sync(() => ws.send(JSON.stringify(["EVENT", subId, event])));
          sentEventIds.add(event.id);
        }
      }
    }
    yield* Effect.sync(() => ws.send(JSON.stringify(["EOSE", subId])));
  });
}
