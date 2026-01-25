import { saveEvent, queryEvents, deleteEvents, cleanupExpiredEvents, countEvents } from "./db.ts";
import {
  parseMessage,
  validateEvent,
  matchFilters,
  isEphemeral,
  validateAuthEvent,
  validateCreatedAt,
} from "./protocol.ts";
import type { Event, Filter } from "nostr-tools";
import type { ServerWebSocket } from "bun";

import * as fs from "node:fs";

type ClientData = {
  subscriptions: Map<string, Filter[]>;
  challenge: string;
  relayUrl: string;
  pubkey?: string;
};

const clients = new Set<ServerWebSocket<ClientData>>();

const defaultRelayInfo = {
  name: "Nostra Relay",
  description: "A fast and lightweight Nostr relay built with Bun, SQLite, and Drizzle.",
  pubkey: "bf2bee5281149c7c350f5d12ae32f514c7864ff10805182f4178538c2c421007", // Placeholder or configurable
  contact: "hi@example.com",
  supported_nips: [
    1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 22, 23, 25, 28, 33, 40, 42, 44, 45, 50,
    51, 57, 65, 78,
  ],
  software: "https://github.com/tani/nostra",
  version: "0.1.0",
  limitation: {
    max_message_length: 65536,
    max_subscriptions: 20,
    max_filters: 10,
    max_limit: 1000,
    max_subid_length: 64,
    min_pow_difficulty: 0,
    auth_required: false,
    payment_required: false,
    restricted_writes: false,
    created_at_lower_limit: 31536000, // 1 year
    created_at_upper_limit: 3600, // 1 hour
  },
};

let relayInfo = defaultRelayInfo;

try {
  if (fs.existsSync("nostra.json")) {
    const fileContent = fs.readFileSync("nostra.json", "utf-8");
    const config = JSON.parse(fileContent);
    relayInfo = { ...defaultRelayInfo, ...config };
    console.log("Loaded configuration from nostra.json");
  } else {
    console.log("nostra.json not found, using default configuration");
  }
} catch (e) {
  console.error("Failed to load nostra.json:", e);
}

const MIN_DIFFICULTY = 0;

// Periodic cleanup
setInterval(
  () => {
    cleanupExpiredEvents().catch(console.error);
  },
  60 * 60 * 1000,
); // Hourly

export const relay = {
  port: 3000,
  fetch(req: Request, server: any) {
    if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const challenge = crypto.randomUUID();
      const url = new URL(req.url);
      const relayUrl = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
      if (
        server.upgrade(req, {
          data: { subscriptions: new Map(), challenge, relayUrl },
        })
      ) {
        return;
      }
      return new Response("Upgrade failed", { status: 400 });
    }

    if (req.headers.get("Accept") === "application/nostr+json") {
      return new Response(JSON.stringify(relayInfo), {
        headers: {
          "Content-Type": "application/nostr+json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      });
    }

    return new Response("Nostra Relay (ws://localhost:3000)");
  },
  websocket: {
    open(ws: ServerWebSocket<ClientData>) {
      clients.add(ws);
      ws.send(JSON.stringify(["AUTH", ws.data.challenge]));
    },
    async message(ws: ServerWebSocket<ClientData>, rawMessage: string | Buffer) {
      const messageStr = typeof rawMessage === "string" ? rawMessage : rawMessage.toString();
      if (messageStr.length > relayInfo.limitation.max_message_length) {
        ws.send(JSON.stringify(["NOTICE", "error: message too large"]));
        return;
      }
      const msg = parseMessage(messageStr);

      if (!msg) return;

      const [type, ...payload] = msg;

      switch (type) {
        case "EVENT": {
          const event = payload[0] as Event;

          // NIP-40: Check expiration on publish
          const expirationTag = event.tags.find((t) => t[0] === "expiration");
          if (expirationTag && expirationTag[1]) {
            const exp = parseInt(expirationTag[1]);
            if (!isNaN(exp) && exp < Math.floor(Date.now() / 1000)) {
              ws.send(JSON.stringify(["OK", event.id, false, "error: event has expired"]));
              return;
            }
          }

          const result = validateEvent(event, MIN_DIFFICULTY);
          if (!result.ok) {
            ws.send(JSON.stringify(["OK", event.id, false, result.reason]));
            return;
          }

          // NIP-22: Check created_at limits
          const timeResult = validateCreatedAt(event.created_at);
          if (!timeResult.ok) {
            ws.send(JSON.stringify(["OK", event.id, false, timeResult.reason]));
            return;
          }

          if (!isEphemeral(event.kind)) {
            await saveEvent(event);
          }
          ws.send(JSON.stringify(["OK", event.id, true, ""]));

          // NIP-09: Handle Deletion Request (kind 5)
          if (event.kind === 5) {
            const eventIds = event.tags
              .filter((t) => t[0] === "e")
              .map((t) => t[1])
              .filter((id): id is string => typeof id === "string");

            const identifiers = event.tags
              .filter((t) => t[0] === "a")
              .map((t) => t[1])
              .filter((id): id is string => typeof id === "string");

            if (eventIds.length > 0 || identifiers.length > 0) {
              await deleteEvents(event.pubkey, eventIds, identifiers, event.created_at);
            }
          }

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

          if (ws.data.subscriptions.size >= relayInfo.limitation.max_subscriptions) {
            ws.send(JSON.stringify(["CLOSED", subId, "error: max subscriptions reached"]));
            return;
          }

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
        case "COUNT": {
          const [subId, ...filters] = payload as [string, ...Filter[]];
          const count = await countEvents(filters);
          ws.send(JSON.stringify(["COUNT", subId, { count }]));
          break;
        }
        case "CLOSE": {
          const subId = payload[0] as string;
          ws.data.subscriptions.delete(subId);
          break;
        }
        case "AUTH": {
          const authEvent = payload[0] as Event;
          const result = validateAuthEvent(authEvent, ws.data.challenge, ws.data.relayUrl);

          if (!result.ok) {
            ws.send(JSON.stringify(["OK", authEvent.id, false, result.reason]));
            return;
          }
          ws.data.pubkey = authEvent.pubkey;
          ws.send(JSON.stringify(["OK", authEvent.id, true, ""]));
          break;
        }
      }
    },
    close(ws: ServerWebSocket<ClientData>) {
      clients.delete(ws);
    },
  },
};
