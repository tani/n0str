import { cleanupExpiredEvents } from "./db.ts";
import { parseMessage } from "./protocol.ts";
import { relayInfo } from "./config.ts";
import type { ServerWebSocket } from "bun";
import type { ClientData } from "./types.ts";

import { handleEvent } from "./handlers/event.ts";
import { handleReq } from "./handlers/req.ts";
import { handleCount } from "./handlers/count.ts";
import { handleClose } from "./handlers/close.ts";
import { handleAuth } from "./handlers/auth.ts";

const clients = new Set<ServerWebSocket<ClientData>>();

export async function runCleanupTick() {
  await cleanupExpiredEvents().catch(console.error);
}

// Periodic cleanup
setInterval(runCleanupTick, 60 * 60 * 1000); // Hourly

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
        case "EVENT":
          await handleEvent(ws, payload, clients);
          break;
        case "REQ":
          await handleReq(ws, payload);
          break;
        case "COUNT":
          await handleCount(ws, payload);
          break;
        case "CLOSE":
          handleClose(ws, payload);
          break;
        case "AUTH":
          handleAuth(ws, payload);
          break;
      }
    },
    close(ws: ServerWebSocket<ClientData>) {
      clients.delete(ws);
    },
  },
};
