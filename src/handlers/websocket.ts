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
    // Abort and clear all active regular subscriptions
    for (const sub of ws.data.subscriptions.values()) {
      sub.abortController.abort();
    }
    ws.data.subscriptions.clear();

    // Abort and clear all active negentropy subscriptions
    for (const negSub of ws.data.negSubscriptions.values()) {
      negSub.abortController.abort();
    }
    ws.data.negSubscriptions.clear();

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
    const eventJson = JSON.stringify(event);
    let count = 0;

    for (const client of this.clients) {
      for (const data of client.data.subscriptions.values()) {
        // Bloom Filter Optimization: Fast skip if definitely no match
        if (data.bloom) {
          const mightMatch =
            data.bloom.test(event.id) ||
            data.bloom.test(event.pubkey) ||
            event.tags.some((tag) => tag[1] && data.bloom!.test(tag[1]));
          if (!mightMatch) continue;
        }

        if (matchFilters(data.filters, event)) {
          // Construct the message string to avoid re-serializing the event object and subId.
          const msg = `["EVENT",${data.subIdJson},${eventJson}]`;
          client.send(msg);
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Sends a JSON-serialized message to a specific WebSocket client.
   * @param ws - The server WebSocket connection.
   * @param message - The message array to send.
   */
  public send(ws: ServerWebSocket<ClientData>, message: unknown[]): void {
    ws.send(JSON.stringify(message));
  }

  /**
   * Returns statistics about current WebSocket connections and subscriptions.
   * @returns An object containing client and subscription counts.
   */
  public getStats() {
    let totalSubscriptions = 0;
    let totalNegSubscriptions = 0;
    for (const client of this.clients) {
      totalSubscriptions += client.data.subscriptions.size;
      totalNegSubscriptions += client.data.negSubscriptions.size;
    }
    return {
      clients: this.clients.size,
      subscriptions: totalSubscriptions,
      negSubscriptions: totalNegSubscriptions,
    };
  }
}
