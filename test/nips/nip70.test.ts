import { engines } from "../utils/engines.ts";
import { expect, test, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { relay, relayService } from "../../src/server.ts";
import { initRepository, getRepository } from "../../src/repository.ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";

describe.each(engines)("Engine: %s > NIP-70 Protected Events", () => {
  beforeAll(async () => {
    await initRepository(":memory:");
    relayService.setRepository(getRepository());
  });

  let server: any;
  let url: string;
  const sk1 = generateSecretKey();
  const sk2 = generateSecretKey();

  beforeEach(() => {
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  test("Reject protected event if not authenticated", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    // Wait for initial AUTH challenge to clear it
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "AUTH") resolve(null);
      };
    });

    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["-"]],
        content: "protected",
      },
      sk1,
    );

    ws.send(JSON.stringify(["EVENT", event]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK" && msg[1] === event.id) resolve(msg);
      };
    });

    expect(response[2]).toBe(false);
    expect(response[3]).toContain("auth-required");
    ws.close();
  });

  test("Reject protected event if authenticated as different user", async () => {
    const ws = new WebSocket(url);
    const challenge = await new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "AUTH") resolve(msg[1]);
      };
    });

    // Authenticate as User 2
    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", url],
          ["challenge", challenge],
        ],
        content: "",
      },
      sk2,
    );
    ws.send(JSON.stringify(["AUTH", authEvent]));

    // Wait for OK
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(null);
      };
    });

    // Send protected event from User 1
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["-"]],
        content: "protected by user 1",
      },
      sk1,
    );

    ws.send(JSON.stringify(["EVENT", event]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK" && msg[1] === event.id) resolve(msg);
      };
    });

    expect(response[2]).toBe(false);
    expect(response[3]).toContain("restricted");
    ws.close();
  });

  test("Accept protected event if authenticated as owner", async () => {
    const ws = new WebSocket(url);
    const challenge = await new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "AUTH") resolve(msg[1]);
      };
    });

    // Authenticate as User 1
    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", url],
          ["challenge", challenge],
        ],
        content: "",
      },
      sk1,
    );
    ws.send(JSON.stringify(["AUTH", authEvent]));

    // Wait for OK
    await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(null);
      };
    });

    // Send protected event from User 1
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["-"]],
        content: "protected by user 1",
      },
      sk1,
    );

    ws.send(JSON.stringify(["EVENT", event]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK" && msg[1] === event.id) resolve(msg);
      };
    });

    expect(response[2]).toBe(true);
    ws.close();
  });
});
