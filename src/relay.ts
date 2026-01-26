import type { ServerWebSocket } from "bun";
import { relayInfo } from "./config.ts";
import { logger } from "./logger.ts";
import type { ClientData } from "./types.ts";
import type { IEventRepository } from "./types.ts";
import { WebSocketManager } from "./websocket.ts";
import { NostrMessageHandler } from "./message.ts";

/**
 * NostrRelay handles the WebSocket server, message routing, and periodic maintenance tasks.
 */
export class NostrRelay {
  private repository: IEventRepository;
  private wsManager: WebSocketManager;
  private messageHandler: NostrMessageHandler;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private _port: number;

  /**
   * Creates an instance of NostrRelay.
   * @param repository - The event repository for persistence.
   * @param port - The port number to listen on (default: 3000).
   */
  constructor(repository: IEventRepository, port: number = 3000) {
    this.repository = repository;
    this.wsManager = new WebSocketManager();
    this.messageHandler = new NostrMessageHandler(
      this.repository,
      this.wsManager,
    );
    this._port = port;
  }

  /**
   * Initializes the relay by setting up the repository and starting maintenance tasks.
   */
  public async init() {
    await this.repository.init();
    this.startCleanupTask();
  }

  /**
   * Starts the periodic cleanup task for expired events.
   */
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

  /**
   * Stops the periodic cleanup task.
   */
  public stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Gracefully shuts down the relay, stopping tasks and closing the repository.
   */
  public async shutdown() {
    this.stop();
    await this.repository.close();
  }

  /**
   * Asynchronous disposal for the relay.
   */
  public async [Symbol.asyncDispose]() {
    await this.shutdown();
  }

  /**
   * Gets the port number the relay is configured to listen on.
   */
  public get port(): number {
    return this._port;
  }

  /**
   * Hook for Bun.serve fetch handler. Handles health checks, NIP-11 requests, and WebSocket upgrades.
   */
  public get fetch() {
    return (req: Request, server: any) => {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return new Response("OK");
      }

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

  /**
   * Hook for Bun.serve websocket handler. Defines handlers for open, message, and close events.
   */
  public get websocket() {
    return {
      open: (ws: ServerWebSocket<ClientData>) => {
        this.wsManager.addClient(ws);
        ws.send(JSON.stringify(["AUTH", ws.data.challenge]));
      },
      message: async (
        ws: ServerWebSocket<ClientData>,
        message: string | Buffer,
      ) => {
        await this.messageHandler.handleMessage(ws, message);
      },
      close: (ws: ServerWebSocket<ClientData>) => {
        this.wsManager.removeClient(ws);
      },
    };
  }
}
