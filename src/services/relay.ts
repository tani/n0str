import type { ServerWebSocket } from "bun";
import { relayInfo } from "../config/config.ts";
import { logger, logMemoryUsage } from "../utils/logger.ts";
import type { ClientData } from "../domain/types.ts";
import type { IEventRepository } from "../domain/types.ts";
import { WebSocketManager } from "../handlers/websocket.ts";
import { NostrMessageHandler } from "../handlers/message.ts";
import { getRelayUrl, getDisplayUrl } from "../utils/proxy.ts";
import { renderWelcomePage } from "../views/welcome.tsx";

/**
 * NostrRelay handles the WebSocket server, message routing, and periodic maintenance tasks.
 */
export class NostrRelay {
  private repository: IEventRepository;
  private wsManager: WebSocketManager;
  private messageHandler: NostrMessageHandler;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private _port: number;

  /**
   * Creates an instance of NostrRelay.
   * @param repository - The event repository for persistence.
   * @param port - The port number to listen on (default: 3000).
   */
  constructor(repository: IEventRepository, port: number = 3000) {
    this.repository = repository;
    this.wsManager = new WebSocketManager();
    this.messageHandler = new NostrMessageHandler(this.repository, this.wsManager);
    this._port = port;
  }

  /**
   * Updates the repository used by the relay and its message handler.
   * @param repository - The new event repository.
   */
  public setRepository(repository: IEventRepository) {
    this.repository = repository;
    this.messageHandler.setRepository(repository);
  }

  /**
   * Initializes the relay by setting up the repository and starting maintenance tasks.
   */
  public async init() {
    await this.repository.init();
    this.startCleanupTask();
    this.startHealthTask();
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
   * Starts periodic memory and health status logging.
   */
  private startHealthTask() {
    this.healthInterval = setInterval(() => {
      const stats = this.wsManager.getStats();
      logMemoryUsage(
        `Clients=${stats.clients}, Subs=${stats.subscriptions}, NegSubs=${stats.negSubscriptions}`,
      );
    }, 60 * 1000); // Every minute
  }

  /**
   * Stops the periodic cleanup and health tasks.
   */
  public stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
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
    return async (req: Request, server: any) => {
      const url = new URL(req.url);
      if (
        url.pathname === "/" &&
        !req.headers.get("Upgrade") &&
        req.headers.get("Accept") !== "application/nostr+json"
      ) {
        const [events, totalEvents] = await Promise.all([
          Array.fromAsync(this.repository.queryEvents({ kinds: [1], limit: 100 })),
          this.repository.countEvents([{}]),
        ]);
        const html = renderWelcomePage(events, relayInfo, getRelayUrl(req), totalEvents);
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (url.pathname === "/health") {
        return new Response("OK");
      }

      if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const challenge = crypto.randomUUID();
        const relayUrl = getRelayUrl(req);

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

      return new Response(`n0str Relay (${getDisplayUrl(req)})`);
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
      message: async (ws: ServerWebSocket<ClientData>, message: string | Buffer) => {
        await this.messageHandler.handleMessage(ws, message);
      },
      close: (ws: ServerWebSocket<ClientData>) => {
        this.wsManager.removeClient(ws);
      },
    };
  }
}
