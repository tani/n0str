import { saveEvent, queryEvents } from "./db.ts";
import { parseMessage, validateEvent, matchFilters } from "./protocol.ts";
import type { Event, Filter } from "nostr-tools";
import type { ServerWebSocket } from "bun";

type Subscription = {
  id: string;
  filters: Filter[];
};

type ClientData = {
  subscriptions: Map<string, Filter[]>;
};

const clients = new Set<ServerWebSocket<ClientData>>();

export const relay = {
  port: 3000,
  fetch(req: Request, server: any) {
    if (server.upgrade(req, { data: { subscriptions: new Map() } })) {
      return;
    }
    return new Response("Upgrade failed", { status: 400 });
  },
  websocket: {
    open(ws: ServerWebSocket<ClientData>) {
      clients.add(ws);
    },
    async message(ws: ServerWebSocket<ClientData>, message: string | Buffer) {
      const data = typeof message === "string" ? message : message.toString();
      const msg = parseMessage(data);

      if (!msg) return;

      const [type, ...payload] = msg;

      switch (type) {
        case "EVENT": {
          const event = payload[0] as Event;
          const result = validateEvent(event);
          if (!result.ok) {
            ws.send(JSON.stringify(["OK", event.id, false, result.reason]));
            return;
          }

          await saveEvent(event);
          ws.send(JSON.stringify(["OK", event.id, true, ""]));

          // Broadcast to matching subscriptions
          for (const client of clients) {
            for (const [subId, filters] of client.data.subscriptions) {
              if (matchFilters(filters, event)) {
                client.send(JSON.stringify(["EVENT", subId, event]));
              }
            }
          }
          break;
        }
        case "REQ": {
          const [subId, ...filters] = payload as [string, ...Filter[]];
          ws.data.subscriptions.set(subId, filters);

          // Send historical events
          const sentEventIds = new Set<string>();
          for (const filter of filters) {
            const events = await queryEvents(filter);
            for (const event of events) {
              if (!sentEventIds.has(event.id)) {
                ws.send(JSON.stringify(["EVENT", subId, event]));
                sentEventIds.add(event.id);
              }
            }
          }
          ws.send(JSON.stringify(["EOSE", subId]));
          break;
        }
        case "CLOSE": {
          const subId = payload[0] as string;
          ws.data.subscriptions.delete(subId);
          break;
        }
      }
    },
    close(ws: ServerWebSocket<ClientData>) {
      clients.delete(ws);
    },
  },
};
