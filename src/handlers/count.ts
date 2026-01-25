import { Effect } from "effect";
import type { ServerWebSocket } from "bun";
import type { ClientData } from "../types";
import type { Filter } from "nostr-tools";
import { countEvents } from "../db";

export function handleCount(ws: ServerWebSocket<ClientData>, payload: unknown[]) {
  return Effect.gen(function* () {
    const [subId, ...filters] = payload as [string, ...Filter[]];
    const count = yield* Effect.tryPromise(() => countEvents(filters));
    yield* Effect.sync(() => ws.send(JSON.stringify(["COUNT", subId, { count }])));
  });
}
