import type { ServerWebSocket } from "bun";
import type { ClientData } from "../domain/types.ts";
import type { Event } from "nostr-tools";
import { matchFilters } from "../domain/nostr.ts";
import { logger } from "../utils/logger.ts";

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
      for (const [subId, data] of client.data.subscriptions) {
        // Bloom Filter Optimization: Fast skip if definitely no match
        if (data.bloom) {
          let mightMatch = data.bloom.test(event.id) || data.bloom.test(event.pubkey);
          if (!mightMatch) {
            for (const tag of event.tags) {
              if (tag[1] && data.bloom.test(tag[1])) {
                mightMatch = true;
                break;
              }
            }
          }
          if (!mightMatch) continue;
        }

        if (matchFilters(data.filters, event)) {
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
