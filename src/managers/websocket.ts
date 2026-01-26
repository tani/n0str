import type { ServerWebSocket } from "bun";
import type { ClientData } from "../interfaces/types.ts";
import type { Event, Filter } from "nostr-tools";
import { matchFilters } from "../utils/nostr.ts";
import { logger } from "../utils/logger.ts";

export class WebSocketManager {
  private clients: Set<ServerWebSocket<ClientData>> = new Set();

  public addClient(ws: ServerWebSocket<ClientData>): void {
    this.clients.add(ws);
    void logger.debug`Client connected. Total clients: ${this.clients.size}`;
  }

  public removeClient(ws: ServerWebSocket<ClientData>): void {
    this.clients.delete(ws);
    void logger.debug`Client disconnected. Total clients: ${this.clients.size}`;
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public getClients(): Set<ServerWebSocket<ClientData>> {
    return this.clients;
  }

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

  public send(ws: ServerWebSocket<ClientData>, message: unknown[]): void {
    ws.send(JSON.stringify(message));
  }
}
