import { cleanupExpiredEvents } from "./repository.ts";
import { ClientMessageSchema, type ClientMessage } from "./nostr.ts";
import { type } from "arktype";
import { relayInfo } from "./config.ts";
import { match } from "arktype";
import type { ServerWebSocket } from "bun";
import type { ClientData } from "./types.ts";

import { handleEvent } from "./handlers/event.ts";
import { handleReq } from "./handlers/req.ts";
import { handleCount } from "./handlers/count.ts";
import { handleClose } from "./handlers/close.ts";
import { handleAuth } from "./handlers/auth.ts";
import { handleNegOpen, handleNegMsg, handleNegClose } from "./handlers/neg.ts";

import { logger } from "./logger.ts";
import { config } from "./args.ts";

const clients = new Set<ServerWebSocket<ClientData>>();

/**
 * Performs a periodic cleanup of expired events from the repository.
 */
export async function runCleanupTick() {
  await cleanupExpiredEvents().catch((err) => void logger.error`Cleanup error: ${err}`);
}

// Periodic cleanup
setInterval(runCleanupTick, 60 * 60 * 1000); // Hourly

/**
 * Bun.serve compatible relay object containing fetch and websocket handlers.
 */
export const relay = {
  port: config.port,
  fetch(req: Request, server: any) {
    if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const challenge = crypto.randomUUID();
      const relayUrl = req.url.replace(/^http/, "ws");
      if (
        server.upgrade(req, {
          data: {
            subscriptions: new Map(),
            challenge,
            relayUrl,
            negSubscriptions: new Map(),
          },
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

    return new Response(`n0str Relay (ws://localhost:${config.port})`);
  },
  websocket: {
    open(ws: ServerWebSocket<ClientData>) {
      clients.add(ws);
      void logger.debug`Client connected. Total clients: ${clients.size}`;
      ws.send(JSON.stringify(["AUTH", ws.data.challenge]));
    },
    async message(ws: ServerWebSocket<ClientData>, rawMessage: string | Buffer) {
      const messageStr = typeof rawMessage === "string" ? rawMessage : rawMessage.toString();
      void logger.trace`Received message: ${messageStr}`;

      if (messageStr.length > relayInfo.limitation.max_message_length) {
        void logger.warn`Message too large: ${messageStr.length} bytes`;
        ws.send(JSON.stringify(["NOTICE", "error: message too large"]));
        return;
      }
      const msg = ClientMessageSchema(messageStr);
      if (msg instanceof type.errors) {
        void logger.debug`Invalid message schema: ${msg.summary}`;
        return;
      }

      await match
        .in<ClientMessage>()
        .at("0")
        .match({
          "'EVENT'": (m) => handleEvent(ws, [m[1]], clients),
          "'REQ'": (m) => handleReq(ws, [m[1], ...m.slice(2)]),
          "'COUNT'": (m) => handleCount(ws, [m[1], ...m.slice(2)]),
          "'AUTH'": (m) => handleAuth(ws, [m[1]]),
          "'CLOSE'": (m) => handleClose(ws, [m[1]]),
          "'NEG-OPEN'": (m) => handleNegOpen(ws, [m[1], m[2], m[3]]),
          "'NEG-MSG'": (m) => handleNegMsg(ws, [m[1], m[2]]),
          "'NEG-CLOSE'": (m) => handleNegClose(ws, [m[1]]),
          default: () => {
            void logger.warn`Unknown message type: ${msg[0]}`;
          },
        })(msg);
    },
    close(ws: ServerWebSocket<ClientData>) {
      clients.delete(ws);
      void logger.debug`Client disconnected. Total clients: ${clients.size}`;
    },
  },
};
