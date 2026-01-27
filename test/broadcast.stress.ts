import { describe, test, expect } from "bun:test";
import { WebSocketManager } from "../src/websocket.ts";
import { SimpleBloomFilter } from "../src/bloom.ts";
import type { ClientData, SubscriptionData } from "../src/types.ts";
import type { ServerWebSocket } from "bun";

describe("Broadcast Stress Test", () => {
  const manager = new WebSocketManager();

  // Mock ServerWebSocket
  const createMockWs = (id: string) => {
    const sent: any[] = [];
    return {
      data: {
        id,
        subscriptions: new Map<string, SubscriptionData>(),
        authenticatedPubkey: null,
        challenge: id,
      },
      send: (msg: string) => sent.push(JSON.parse(msg)),
      getSent: () => sent,
    } as unknown as ServerWebSocket<ClientData>;
  };

  test("Broadcast to 1,000 clients with 20 subscriptions each (Optimized with Bloom)", () => {
    const CLIENT_COUNT = 1000;
    const SUBS_PER_CLIENT = 20;
    const clients: any[] = [];

    const authorsWithBloom = Array.from({ length: 500 }, (_, i) =>
      i.toString(16).padStart(64, "0"),
    );

    for (let i = 0; i < CLIENT_COUNT; i++) {
      const ws = createMockWs(`ws-${i}`);
      for (let j = 0; j < SUBS_PER_CLIENT; j++) {
        // Half of subscriptions have Bloom filters for a specific author
        const author = authorsWithBloom[(i * SUBS_PER_CLIENT + j) % authorsWithBloom.length]!;
        const bloom = new SimpleBloomFilter();
        bloom.add(author);

        ws.data.subscriptions.set(`sub-${j}`, {
          filters: [{ authors: [author] }],
          bloom,
        });
      }
      manager.addClient(ws);
      clients.push(ws);
    }

    const startTime = Date.now();
    const EVENT_COUNT = 100;
    let totalBroadcasts = 0;

    for (let k = 0; k < EVENT_COUNT; k++) {
      const pubkey = authorsWithBloom[k % authorsWithBloom.length]!;
      const event = {
        id: k.toString(16).padStart(64, "0"),
        pubkey,
        created_at: 1000,
        kind: 1,
        tags: [],
        content: "hello",
        sig: "0".repeat(128),
      };
      totalBroadcasts += manager.broadcast(event);
    }

    const duration = Date.now() - startTime;
    console.log(
      `Broadcast Stress: ${EVENT_COUNT} events to ${CLIENT_COUNT} clients (${CLIENT_COUNT * SUBS_PER_CLIENT} subs total) in ${duration}ms`,
    );
    console.log(`Total actual broadcasts: ${totalBroadcasts}`);

    expect(duration).toBeLessThan(5000); // Should be very fast with Bloom filters
  });

  test("Broadcast to 1,000 clients (Linear match - Worst case)", () => {
    // Clear previous clients
    for (const ws of manager.getClients()) {
      manager.removeClient(ws);
    }

    const CLIENT_COUNT = 1000;
    const SUBS_PER_CLIENT = 20;

    for (let i = 0; i < CLIENT_COUNT; i++) {
      const ws = createMockWs(`ws-no-bloom-${i}`);
      for (let j = 0; j < SUBS_PER_CLIENT; j++) {
        ws.data.subscriptions.set(`sub-${j}`, {
          filters: [{ kinds: [1] }],
          // No bloom filter
        });
      }
      manager.addClient(ws);
    }

    const startTime = Date.now();
    const EVENT_COUNT = 10; // Fewer events because it's slower
    for (let k = 0; k < EVENT_COUNT; k++) {
      const event = {
        id: "id" + k,
        pubkey: "pk" + k,
        created_at: 1000,
        kind: 1,
        tags: [],
        content: "hello",
        sig: "0".repeat(128),
      };
      manager.broadcast(event);
    }

    const duration = Date.now() - startTime;
    console.log(
      `Linear Broadcast Stress: ${EVENT_COUNT} events to ${CLIENT_COUNT} clients in ${duration}ms`,
    );
  });
});
