import type { ServerWebSocket } from "bun";
import type { ClientData } from "../domain/types.ts";
import type { IEventRepository } from "../domain/types.ts";
import type { WebSocketManager } from "./websocket.ts";
import { type } from "arktype";
import {
  EventSchema,
  validateEvent,
  validateCreatedAt,
  isEphemeral,
  validateAuthEvent,
  ClientMessageSchema,
  type ClientMessage,
} from "../domain/nostr.ts";
import { SimpleBloomFilter } from "../db/bloom.ts";
import { logger } from "../utils/logger.ts";

import type { Filter } from "nostr-tools";
import { relayInfo } from "../config/config.ts";
// @ts-ignore
import { Negentropy, NegentropyStorageVector } from "../libs/negentropy.js";
import { match } from "arktype";

/**
 * NostrMessageHandler processes incoming Nostr messages (EVENT, REQ, CLOSE, etc.)
 * and orchestrates responses, storage, and broadcasting.
 */
export class NostrMessageHandler {
  /**
   * Creates an instance of NostrMessageHandler.
   * @param repository - The event repository for persistence.
   * @param wsManager - The WebSocket manager for broadcasting.
   */
  constructor(
    private repository: IEventRepository,
    private wsManager: WebSocketManager,
  ) {}

  /**
   * Updates the repository used by the message handler.
   * @param repository - The new event repository.
   */
  public setRepository(repository: IEventRepository) {
    this.repository = repository;
  }

  /**
   * Handles an incoming raw WebSocket message.
   * @param ws - The server WebSocket connection.
   * @param rawMessage - The raw message data (string or Buffer).
   */
  public async handleMessage(ws: ServerWebSocket<ClientData>, rawMessage: string | Buffer) {
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
        "'EVENT'": (m) => this.handleEvent(ws, [m[1]]),
        "'REQ'": (m) => this.handleReq(ws, [m[1], ...m.slice(2)]),
        "'COUNT'": (m) => this.handleCount(ws, [m[1], ...m.slice(2)]),
        "'AUTH'": (m) => this.handleAuth(ws, [m[1]]),
        "'CLOSE'": (m) => this.handleClose(ws, [m[1]]),
        "'NEG-OPEN'": (m) => this.handleNegOpen(ws, [m[1], m[2], m[3]]),
        "'NEG-MSG'": (m) => this.handleNegMsg(ws, [m[1], m[2]]),
        "'NEG-CLOSE'": (m) => this.handleNegClose(ws, [m[1]]),
        default: () => {
          void logger.warn`Unknown message type: ${msg[0]}`;
        },
      })(msg);
  }

  /**
   * Processes a Nostr EVENT message.
   * @param ws - The server WebSocket connection.
   * @param payload - The message payload containing the event object.
   */
  private async handleEvent(ws: ServerWebSocket<ClientData>, payload: any[]) {
    const rawEvent = payload[0];
    const event = EventSchema(rawEvent);
    if (event instanceof type.errors) {
      void logger.debug`Malformed event received from ${ws.remoteAddress}: ${event.summary}`;
      ws.send(JSON.stringify(["OK", rawEvent?.id ?? "unknown", false, "error: malformed event"]));
      return;
    }

    void logger.trace`Processing event: ${event.id} (kind: ${event.kind}) from ${event.pubkey}`;

    // NIP-40: Check expiration on publish
    const expirationTag = event.tags.find((t) => t[0] === "expiration");
    if (expirationTag && expirationTag[1]) {
      const exp = parseInt(expirationTag[1]);
      if (!isNaN(exp) && exp < Math.floor(Date.now() / 1000)) {
        void logger.debug`Event ${event.id} expired on publish`;
        ws.send(JSON.stringify(["OK", event.id, false, "error: event has expired"]));
        return;
      }
    }

    const result = await validateEvent(event, relayInfo.limitation.min_pow_difficulty);
    if (!result.ok) {
      void logger.debug`Event ${event.id} validation failed: ${result.reason}`;
      ws.send(JSON.stringify(["OK", event.id, false, result.reason]));
      return;
    }

    // NIP-22: Check created_at limits
    const timeResult = await validateCreatedAt(event.created_at);
    if (!timeResult.ok) {
      void logger.debug`Event ${event.id} timestamp invalid: ${timeResult.reason}`;
      ws.send(JSON.stringify(["OK", event.id, false, timeResult.reason]));
      return;
    }

    // NIP-70: Protected Events
    const protectedTag = event.tags.find((t) => t[0] === "-");
    if (protectedTag) {
      if (!ws.data.pubkey) {
        void logger.debug`Protected event ${event.id} rejected: auth required`;
        ws.send(
          JSON.stringify([
            "OK",
            event.id,
            false,
            "auth-required: this event may only be published by its author",
          ]),
        );
        ws.send(JSON.stringify(["AUTH", ws.data.challenge]));
        return;
      }
      if (ws.data.pubkey !== event.pubkey) {
        void logger.debug`Protected event ${event.id} rejected: pubkey mismatch`;
        ws.send(
          JSON.stringify([
            "OK",
            event.id,
            false,
            "restricted: this event may only be published by its author",
          ]),
        );
        return;
      }
    }

    if (!isEphemeral(event.kind)) {
      await this.repository.saveEvent(event);
      void logger.trace`Event ${event.id} saved to database`;
    }
    ws.send(JSON.stringify(["OK", event.id, true, ""]));

    if (event.kind === 5) {
      const eventIds = event.tags
        .filter((t) => t[0] === "e")
        .flatMap((t) => (typeof t[1] === "string" ? [t[1]] : []));
      const identifiers = event.tags
        .filter((t) => t[0] === "a")
        .flatMap((t) => (typeof t[1] === "string" ? [t[1]] : []));

      if (eventIds.length > 0 || identifiers.length > 0) {
        await this.repository.deleteEvents(event.pubkey, eventIds, identifiers, event.created_at);
        void logger.trace`Deleted events based on event ${event.id}`;
      }
    }

    // Broadcast to matching subscriptions
    const broadcastCount = this.wsManager.broadcast(event);
    void logger.trace`Event ${event.id} broadcasted to ${broadcastCount} subscriptions`;
  }

  /**
   * Processes a Nostr REQ message to start a subscription.
   * @param ws - The server WebSocket connection.
   * @param payload - The message payload containing subId and filters.
   */
  private async handleReq(ws: ServerWebSocket<ClientData>, payload: any[]) {
    const [subId, ...filters] = payload as [string, ...Filter[]];

    void logger.trace`REQ received for subId: ${subId} with ${filters.length} filters`;

    if (ws.data.subscriptions.size >= relayInfo.limitation.max_subscriptions) {
      void logger.debug`Max subscriptions reached for ${ws.remoteAddress} (subId: ${subId})`;
      ws.send(JSON.stringify(["CLOSED", subId, "error: max subscriptions reached"]));
      return;
    }

    if (filters.length > relayInfo.limitation.max_filters) {
      void logger.debug`Too many filters for ${ws.remoteAddress} (subId: ${subId})`;
      ws.send(JSON.stringify(["CLOSED", subId, "error: too many filters"]));
      return;
    }
    const bloom = this.buildBloomFilter(filters);
    ws.data.subscriptions.set(subId, {
      filters,
      bloom,
      subIdJson: JSON.stringify(subId),
    });

    // Send historical events
    const useSet = filters.length > 1;
    const sentEventIds = useSet ? new Set<string>() : null;
    let eventCount = 0;

    for (const filter of filters) {
      if (filter.limit === undefined || filter.limit > relayInfo.limitation.max_limit) {
        filter.limit = relayInfo.limitation.max_limit;
      }
      for await (const event of this.repository.queryEvents(filter)) {
        if (!sentEventIds || !sentEventIds.has(event.id)) {
          ws.send(JSON.stringify(["EVENT", subId, event]));
          sentEventIds?.add(event.id);
          eventCount++;
        }
      }
    }

    void logger.trace`Sent ${eventCount} stored events for subId: ${subId} (Bloom: ${!!bloom})`;
    ws.send(JSON.stringify(["EOSE", subId]));
  }

  /**
   * Builds a Bloom Filter for a set of filters to optimize broadcassting.
   * If any filter is too broad, it returns undefined to fallback to full matching.
   */
  private buildBloomFilter(filters: Filter[]): SimpleBloomFilter | undefined {
    // If any filter is too broad (no IDs, authors, or tag filters), skip Bloom optimization
    const isBroad = filters.some(
      (f) =>
        (f.ids?.length ?? 0) === 0 &&
        (f.authors?.length ?? 0) === 0 &&
        !Object.keys(f).some((k) => k.startsWith("#")),
    );
    if (isBroad) return undefined;

    const items = Iterator.from(filters)
      .flatMap((f) => {
        const fItems: string[] = [];
        if (f.ids) fItems.push(...f.ids);
        if (f.authors) fItems.push(...f.authors);
        for (const [k, v] of Object.entries(f)) {
          if (k.startsWith("#") && Array.isArray(v)) {
            for (const val of v) if (typeof val === "string") fItems.push(val);
          }
        }
        return fItems;
      })
      .toArray();

    if (items.length === 0) return undefined;

    const bloom = new SimpleBloomFilter(Math.max(items.length, 10));
    for (const item of items) bloom.add(item);
    return bloom;
  }

  /**
   * Processes a Nostr COUNT message.
   * @param ws - The server WebSocket connection.
   * @param payload - The message payload containing subId and filters.
   */
  private async handleCount(ws: ServerWebSocket<ClientData>, payload: any[]) {
    const [subId, ...filters] = payload as [string, ...Filter[]];
    void logger.trace`COUNT received for subId: ${subId}`;
    const count = await this.repository.countEvents(filters);
    ws.send(JSON.stringify(["COUNT", subId, { count }]));
    void logger.trace`COUNT result for ${subId}: ${count}`;
  }

  /**
   * Processes a Nostr AUTH message for client authentication.
   * @param ws - The server WebSocket connection.
   * @param payload - The message payload containing the auth event.
   */
  private async handleAuth(ws: ServerWebSocket<ClientData>, payload: any[]) {
    const event = payload[0];
    void logger.trace`AUTH received from ${ws.remoteAddress}`;

    const result = await validateAuthEvent(event, ws.data.challenge, ws.data.relayUrl);
    if (!result.ok) {
      void logger.debug`Auth validation failed: ${result.reason}`;
      ws.send(JSON.stringify(["OK", event.id, false, result.reason]));
      return;
    }

    ws.data.pubkey = event.pubkey;
    void logger.info`Client authenticated as ${event.pubkey}`;
    ws.send(JSON.stringify(["OK", event.id, true, ""]));
  }

  /**
   * Processes a Nostr CLOSE message to end a subscription.
   * @param ws - The server WebSocket connection.
   * @param payload - The message payload containing the subId to close.
   */
  private handleClose(ws: ServerWebSocket<ClientData>, payload: any[]) {
    const subId = payload[0] as string;
    ws.data.subscriptions.delete(subId);
    void logger.trace`Subscription closed: ${subId}`;
  }

  /**
   * Processes a NIP-77 NEG-OPEN message for negentropy sync.
   * @param ws - The server WebSocket connection.
   * @param args - The message arguments for negentropy open.
   */
  private async handleNegOpen(ws: ServerWebSocket<ClientData>, args: any[]) {
    const [subId, filter, initialMessage] = args;

    if (ws.data.negSubscriptions.has(subId)) {
      void logger.debug`Replacing existing neg subscription: ${subId}`;
      ws.data.negSubscriptions.delete(subId);
    }

    try {
      void logger.trace`NEG-OPEN for ${subId}`;

      // Apply limit for sync query to prevent OOM
      if (filter.limit === undefined || filter.limit > relayInfo.limitation.max_limit) {
        filter.limit = relayInfo.limitation.max_limit;
      }

      const storage = new NegentropyStorageVector();

      for await (const event of this.repository.queryEventsForSync(filter)) {
        storage.insert(event.created_at, event.id);
      }
      storage.seal();

      const neg = new Negentropy(storage, 1024 * 1024); // 1MB limit?
      const result = await neg.reconcile(initialMessage);
      const outputMessage = result[0];

      ws.data.negSubscriptions.set(subId, neg);

      if (outputMessage) {
        ws.send(JSON.stringify(["NEG-MSG", subId, outputMessage]));
      } else {
        ws.send(JSON.stringify(["NEG-MSG", subId, outputMessage ?? ""]));
      }
      void logger.trace`NEG-OPEN processed for ${subId}`;
    } catch (err: any) {
      void logger.debug`NEG-OPEN error for ${subId}: ${err.message}`;
      ws.send(JSON.stringify(["NEG-ERR", subId, "error: " + err.message]));
    }
  }

  /**
   * Processes a NIP-77 NEG-MSG message for negentropy sync.
   * @param ws - The server WebSocket connection.
   * @param args - The message arguments for negentropy sync.
   */
  private async handleNegMsg(ws: ServerWebSocket<ClientData>, args: any[]) {
    const [subId, message] = args;
    const neg = ws.data.negSubscriptions.get(subId);

    if (!neg) {
      void logger.debug`NEG-MSG for unknown subscription: ${subId}`;
      ws.send(JSON.stringify(["NEG-ERR", subId, "closed: subscription not found"]));
      return;
    }

    try {
      const result = await neg.reconcile(message);
      const outputMessage = result[0];
      if (outputMessage) {
        ws.send(JSON.stringify(["NEG-MSG", subId, outputMessage]));
      }
    } catch (err: any) {
      void logger.debug`NEG-MSG error for ${subId}: ${err.message}`;
      ws.send(JSON.stringify(["NEG-ERR", subId, "error: " + err.message]));
    }
  }

  /**
   * Processes a NIP-77 NEG-CLOSE message to end negentropy sync.
   * @param ws - The server WebSocket connection.
   * @param args - The message arguments for negentropy close.
   */
  private handleNegClose(ws: ServerWebSocket<ClientData>, args: any[]) {
    const [subId] = args;
    ws.data.negSubscriptions.delete(subId);
    void logger.trace`NEG-CLOSE for ${subId}`;
  }
}
