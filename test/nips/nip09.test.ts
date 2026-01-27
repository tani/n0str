import { engines } from "../utils/engines.ts";
import { expect, test, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { relay, relayService } from "../../src/server.ts";
import { clear, queryEvents, initRepository, getRepository } from "../../src/repository.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";

async function consumeAuth(ws: WebSocket) {
  return new Promise((resolve) => {
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg[0] === "AUTH") resolve(msg[1]);
    };
  });
}

describe.each(engines)("Engine: %s > NIP-09 Event Deletion", () => {
  beforeAll(async () => {
    await initRepository(":memory:");
    relayService.setRepository(getRepository());
  });

  let server: any;
  let url: string;

  beforeEach(async () => {
    await clear();

    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  const sk1 = generateSecretKey();
  const pk1 = getPublicKey(sk1);
  const sk2 = generateSecretKey();

  test("Delete event by author", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    // 1. Publish an event
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "to be deleted",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", event]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    }); // Wait for OK

    // 2. Verify it exists
    expect(await queryEvents({ ids: [event.id] })).toHaveLength(1);

    // 3. Publish a deletion request (kind 5)
    const deletion = finalizeEvent(
      {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000) + 1,
        tags: [["e", event.id]],
        content: "oops",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", deletion]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    }); // Wait for OK

    // 4. Verify original event is gone
    expect(await queryEvents({ ids: [event.id] })).toHaveLength(0);

    // 5. Verify deletion request itself exists
    expect(await queryEvents({ ids: [deletion.id] })).toHaveLength(1);

    ws.close();
  });

  test("Fail to delete event by others", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    // 1. Publish an event by user 1
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: "secure content",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", event]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 2. Try to delete by user 2
    const deletion = finalizeEvent(
      {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000) + 1,
        tags: [["e", event.id]],
        content: "I want this gone",
      },
      sk2,
    );
    ws.send(JSON.stringify(["EVENT", deletion]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 3. Verify original event STILL exists
    expect(await queryEvents({ ids: [event.id] })).toHaveLength(1);

    ws.close();
  });

  test("Delete replaceable event by 'a' tag", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));
    await consumeAuth(ws);

    // 1. Publish a replaceable event (kind 30000)
    const event = finalizeEvent(
      {
        kind: 30000,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["d", "test-d"]],
        content: "replaceable",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", event]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 2. Verify it exists
    expect(await queryEvents({ kinds: [30000] })).toHaveLength(1);

    // 3. Publish deletion request with 'a' tag
    const deletion = finalizeEvent(
      {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000) + 1,
        tags: [["a", `30000:${pk1}:test-d`]],
        content: "delete by a tag",
      },
      sk1,
    );
    ws.send(JSON.stringify(["EVENT", deletion]));
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        if (JSON.parse(e.data)[0] === "OK") resolve(null);
      };
    });

    // 4. Verify original event is gone
    expect(await queryEvents({ kinds: [30000] })).toHaveLength(0);

    ws.close();
  });
});
