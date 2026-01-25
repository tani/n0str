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

function renderWelcomePage(info: typeof relayInfo) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${info.name}</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
        h1 { color: #333; }
        .card { border: 1px solid #eee; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
        code { background: #f5f5f5; padding: 0.2em 0.4em; border-radius: 4px; word-break: break-all; }
        ul { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; padding: 0; }
        li { background: #e0e0e0; padding: 0.2rem 0.6rem; border-radius: 1rem; font-size: 0.9em; }
    </style>
</head>
<body>
    <h1>${info.name}</h1>
    <p>${info.description}</p>

    <div class="card">
        <h3>Relay Information</h3>
        <p><strong>Admin:</strong> <a href="mailto:${info.contact}">${info.contact}</a></p>
        <p><strong>Pubkey:</strong> <code>${info.pubkey}</code></p>
        <p><strong>Software:</strong> <a href="${info.software}">${info.software}</a> ${info.version}</p>
    </div>

    <div class="card">
        <h3>Supported NIPs</h3>
        <ul>
            ${info.supported_nips.map((nip) => `<li>NIP-${nip}</li>`).join("")}
        </ul>
    </div>
</body>
</html>`;
}

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
  port: parseInt(process.env.PORT || "3000"),
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

    return new Response(renderWelcomePage(relayInfo), {
      headers: {
        "Content-Type": "text/html",
      },
    });
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
