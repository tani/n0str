import type { ServerWebSocket } from "bun";
import { relayInfo } from "../config.ts";
import { logger } from "../logger.ts";
import type { ClientData } from "../types.ts";
import { SqliteEventRepository } from "../repositories/SqliteEventRepository.ts";
import { WebSocketManager } from "../managers/WebSocketManager.ts";
import { NostrMessageHandler } from "../handlers/NostrMessageHandler.ts";

export class NostrRelay {
  private repository: SqliteEventRepository;
  private wsManager: WebSocketManager;
  private messageHandler: NostrMessageHandler;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.repository = new SqliteEventRepository();
    this.wsManager = new WebSocketManager();
    this.messageHandler = new NostrMessageHandler(this.repository, this.wsManager);
  }

  public async init() {
    await this.repository.init();
    this.startCleanupTask();
  }

  private startCleanupTask() {
    this.cleanupInterval = setInterval(
      async () => {
        await this.repository
          .cleanupExpiredEvents()
          .catch((err) => void logger.error`Cleanup error: ${err}`);
      },
      60 * 60 * 1000,
    ); // Hourly
  }

  public stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  public get port(): number {
    return parseInt(process.env.PORT || "3000");
  }

  public get fetch() {
    return (req: Request, server: any) => {
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

      return new Response(`n0str Relay (ws://localhost:${this.port})`);
    };
  }

  public get websocket() {
    return {
      open: (ws: ServerWebSocket<ClientData>) => {
        this.wsManager.addClient(ws);
        ws.send(JSON.stringify(["AUTH", ws.data.challenge]));
      },
      message: async (ws: ServerWebSocket<ClientData>, message: string | Buffer) => {
        await this.messageHandler.handleMessage(ws, message);
      },
      close: (ws: ServerWebSocket<ClientData>) => {
        this.wsManager.removeClient(ws);
      },
    };
  }
}
