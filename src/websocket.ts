import type { ServerWebSocket } from "bun";
import type { ClientData } from "./types.ts";
import type { Event } from "nostr-tools";
import { matchFilters } from "./nostr.ts";
import { logger } from "./logger.ts";

/**
 * WebSocketManager tracks active WebSocket connections and handles event broadcasting.
 */
export class WebSocketManager {
  private clients: Set<ServerWebSocket<ClientData>> = new Set();

  constructor() {
    void logger.debug`WebSocketManager initialized`;
  }

  /**
   * Adds a new WebSocket client to the manager.
   * @param ws - The server WebSocket connection.
   */
  public addClient(ws: ServerWebSocket<ClientData>): void {
    this.clients.add(ws);
    void logger.debug`Client connected. Total clients: ${this.clients.size}`;
  }

  /**
   * Removes a WebSocket client from the manager.
   * @param ws - The server WebSocket connection.
   */
  public removeClient(ws: ServerWebSocket<ClientData>): void {
    this.clients.delete(ws);
    void logger.debug`Client disconnected. Total clients: ${this.clients.size}`;
  }

  /**
   * Gets the current number of active WebSocket connections.
   * @returns The client count.
   */
  public getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Returns the set of all active WebSocket connections.
   * @returns A Set of server WebSockets.
   */
  public getClients(): Set<ServerWebSocket<ClientData>> {
    return this.clients;
  }

  /**
   * Broadcasts a Nostr event to all clients with matching subscriptions.
   * @param event - The Nostr event to broadcast.
   * @returns The number of clients/subscriptions the event was sent to.
   */
  public broadcast(event: Event): number {
    let broadcastCount = 0;
    for (const client of this.clients) {
      for (const [subId, filters] of client.data.subscriptions) {
        if (matchFilters(filters, event)) {
          client.send(JSON.stringify(["EVENT", subId, event]));
          broadcastCount++;
        }
      }
    }
    return broadcastCount;
  }

  /**
   * Sends a JSON-serialized message to a specific WebSocket client.
   * @param ws - The server WebSocket connection.
   * @param message - The message array to send.
   */
  public send(ws: ServerWebSocket<ClientData>, message: unknown[]): void {
    ws.send(JSON.stringify(message));
  }
}
