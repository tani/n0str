import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { relay } from "../../src/server.ts";
import { finalizeEvent, generateSecretKey } from "nostr-tools";

describe("NIP-42 Authentication", () => {
  let server: any;
  let url: string;

  beforeEach(() => {
    server = Bun.serve({ ...relay, port: 0 });
    url = `ws://localhost:${server.port}`;
  });

  afterEach(() => {
    server.stop();
  });

  const sk = generateSecretKey();

  test("Client receives challenge on connect", async () => {
    const ws = new WebSocket(url);
    const challenge = await new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "AUTH") resolve(msg[1]);
      };
    });
    expect(challenge).toBeDefined();
    expect(typeof challenge).toBe("string");
    ws.close();
  });

  test("Successful authentication", async () => {
    const ws = new WebSocket(url);
    const challenge = await new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "AUTH") resolve(msg[1]);
      };
    });

    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", `ws://localhost:${server.port}`],
          ["challenge", challenge],
        ],
        content: "",
      },
      sk,
    );

    ws.send(JSON.stringify(["AUTH", authEvent]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(msg);
      };
    });

    expect(response[0]).toBe("OK");
    expect(response[1]).toBe(authEvent.id);
    expect(response[2]).toBe(true);
    ws.close();
  });

  test("Fails on wrong challenge", async () => {
    const ws = new WebSocket(url);
    await new Promise((resolve) => (ws.onopen = resolve));

    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", `ws://localhost:${server.port}`],
          ["challenge", "wrong-challenge"],
        ],
        content: "",
      },
      sk,
    );

    ws.send(JSON.stringify(["AUTH", authEvent]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(msg);
      };
    });

    expect(response[2]).toBe(false);
    expect(response[3]).toBe("invalid: challenge mismatch");
    ws.close();
  });

  test("Fails on wrong relay URL", async () => {
    const ws = new WebSocket(url);
    const challenge = await new Promise<string>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "AUTH") resolve(msg[1]);
      };
    });

    const authEvent = finalizeEvent(
      {
        kind: 22242,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["relay", "ws://wrong.relay"],
          ["challenge", challenge],
        ],
        content: "",
      },
      sk,
    );

    ws.send(JSON.stringify(["AUTH", authEvent]));

    const response = await new Promise<any>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg[0] === "OK") resolve(msg);
      };
    });

    expect(response[2]).toBe(false);
    expect(response[3]).toContain("invalid: relay tag mismatch");
    ws.close();
  });
});
