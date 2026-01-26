import type { ServerWebSocket } from "bun";
import type { ClientData } from "../interfaces/types.ts";
import type { IEventRepository } from "../repositories/types.ts";
import type { WebSocketManager } from "../managers/websocket.ts";
import { type } from "arktype";
import {
  EventSchema,
  validateEvent,
  validateCreatedAt,
  isEphemeral,
  validateAuthEvent,
  ClientMessageSchema,
  type ClientMessage,
} from "../utils/nostr.ts";
import { logger } from "../utils/logger.ts";
import type { Filter } from "nostr-tools";
import { relayInfo } from "../config/index.ts";
// @ts-ignore
import { Negentropy, NegentropyStorageVector } from "../utils/negentropy.js";
import { match } from "arktype";

const MIN_DIFFICULTY = 0;

export class NostrMessageHandler {
  constructor(
    private repository: IEventRepository,
    private wsManager: WebSocketManager,
  ) {}

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

    const result = await validateEvent(event, MIN_DIFFICULTY);
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

  private async handleReq(ws: ServerWebSocket<ClientData>, payload: any[]) {
    const [subId, ...filters] = payload as [string, ...Filter[]];

    void logger.trace`REQ received for subId: ${subId} with ${filters.length} filters`;

    if (ws.data.subscriptions.size >= relayInfo.limitation.max_subscriptions) {
      void logger.debug`Max subscriptions reached for ${ws.remoteAddress} (subId: ${subId})`;
      ws.send(JSON.stringify(["CLOSED", subId, "error: max subscriptions reached"]));
      return;
    }

    ws.data.subscriptions.set(subId, filters);

    // Send historical events
    const sentEventIds = new Set<string>();
    let eventCount = 0;
    for (const filter of filters) {
      const events = await this.repository.queryEvents(filter);
      for (const event of events) {
        if (!sentEventIds.has(event.id)) {
          ws.send(JSON.stringify(["EVENT", subId, event]));
          sentEventIds.add(event.id);
          eventCount++;
        }
      }
    }
    void logger.trace`Sent ${eventCount} stored events for subId: ${subId}`;
    ws.send(JSON.stringify(["EOSE", subId]));
  }

  private async handleCount(ws: ServerWebSocket<ClientData>, payload: any[]) {
    const [subId, ...filters] = payload as [string, ...Filter[]];
    void logger.trace`COUNT received for subId: ${subId}`;
    const count = await this.repository.countEvents(filters);
    ws.send(JSON.stringify(["COUNT", subId, { count }]));
    void logger.trace`COUNT result for ${subId}: ${count}`;
  }

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

  private handleClose(ws: ServerWebSocket<ClientData>, payload: any[]) {
    const subId = payload[0] as string;
    ws.data.subscriptions.delete(subId);
    void logger.trace`Subscription closed: ${subId}`;
  }

  private async handleNegOpen(ws: ServerWebSocket<ClientData>, args: any[]) {
    const [subId, filter, initialMessage] = args;

    if (ws.data.negSubscriptions.has(subId)) {
      void logger.debug`Replacing existing neg subscription: ${subId}`;
      ws.data.negSubscriptions.delete(subId);
    }

    try {
      void logger.trace`NEG-OPEN for ${subId}`;
      const events = await this.repository.queryEventsForSync(filter);
      const storage = new NegentropyStorageVector();

      for (const event of events) {
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
      void logger.error`NEG-OPEN error for ${subId}: ${err.message}`;
      ws.send(JSON.stringify(["NEG-ERR", subId, "error: " + err.message]));
    }
  }

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
      void logger.error`NEG-MSG error for ${subId}: ${err.message}`;
      ws.send(JSON.stringify(["NEG-ERR", subId, "error: " + err.message]));
    }
  }

  private handleNegClose(ws: ServerWebSocket<ClientData>, args: any[]) {
    const [subId] = args;
    ws.data.negSubscriptions.delete(subId);
    void logger.trace`NEG-CLOSE for ${subId}`;
  }
}
