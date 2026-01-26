import { expect, test, describe, beforeAll, beforeEach, afterEach } from "bun:test";
import { relay } from "../../src/server.ts";
import { db, queryEvents } from "../../src/repository.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe("Event Treatment (NIP-01)", () => {
  const dbPath = "n0str.test.db";
  let server: any;
  let url: string;

  beforeAll(() => {
    process.env.DATABASE_PATH = dbPath;
  });

  beforeEach(async () => {
    await db`DELETE FROM events`;
    await db`DELETE FROM tags`;
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  const sk1 = generateSecretKey();
  const pk1 = getPublicKey(sk1);

  test("Ephemeral events (kind 20000) are not stored", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const event = finalizeEvent(
      {
        kind: 20000,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "ephemeral",
      },
      sk1,
    );

    ws.send(JSON.stringify(["EVENT", event]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    }); // Wait for OK

    const stored = await queryEvents({ kinds: [20000] });
    expect(stored).toHaveLength(0);

    ws.close();
  });

  test("Replaceable events (kind 0) use replacement logic", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);

    // 1. Publish older event
    const event1 = finalizeEvent(
      {
        kind: 0,
        created_at: now - 100,
        tags: [],
        content: "old",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", event1]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 2. Publish newer event
    const event2 = finalizeEvent(
      {
        kind: 0,
        created_at: now,
        tags: [],
        content: "new",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", event2]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 3. Verify only newer exists
    const stored = await queryEvents({ kinds: [0], authors: [pk1] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toBe("new");

    // 4. Try to publish even older event
    const event3 = finalizeEvent(
      {
        kind: 0,
        created_at: now - 50,
        tags: [],
        content: "ignored",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", event3]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    const storedAtEnd = await queryEvents({ kinds: [0], authors: [pk1] });
    expect(storedAtEnd).toHaveLength(1);
    expect(storedAtEnd[0]?.content).toBe("new");

    ws.close();
  });

  test("Addressable events (kind 30000) use d-tag replacement logic", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    const now = Math.floor(Date.now() / 1000);

    // 1. Publish event with d=a
    const eventA = finalizeEvent(
      {
        kind: 30000,
        created_at: now,
        tags: [["d", "a"]],
        content: "content-a",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", eventA]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 2. Publish event with d=b
    const eventB = finalizeEvent(
      {
        kind: 30000,
        created_at: now,
        tags: [["d", "b"]],
        content: "content-b",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", eventB]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 3. Both should exist
    expect(await queryEvents({ kinds: [30000] })).toHaveLength(2);

    // 4. Update event d=a
    const eventA2 = finalizeEvent(
      {
        kind: 30000,
        created_at: now + 10,
        tags: [["d", "a"]],
        content: "content-a-updated",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", eventA2]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 5. Should still have 2, but one updated
    const finalStored = await queryEvents({ kinds: [30000] });
    expect(finalStored).toHaveLength(2);
    expect(finalStored.find((e) => e.tags.find((t) => t[0] === "d" && t[1] === "a"))?.content).toBe(
      "content-a-updated",
    );

    ws.close();
  });
});
