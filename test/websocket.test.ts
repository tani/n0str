import { expect, test, describe } from "bun:test";
import { WebSocketManager } from "../src/handlers/websocket.ts";

describe("websocket coverage", () => {
  test("WebSocketManager tracks clients", () => {
    const manager = new WebSocketManager();
    const ws1 = { send: () => {} } as any;
    const ws2 = { send: () => {} } as any;

    manager.addClient(ws1);
    expect(manager.getClientCount()).toBe(1);

    manager.addClient(ws2);
    expect(manager.getClientCount()).toBe(2);
    expect(manager.getClients().size).toBe(2);

    manager.removeClient(ws1);
    expect(manager.getClientCount()).toBe(1);
    expect(manager.getClients().has(ws1)).toBe(false);
    expect(manager.getClients().has(ws2)).toBe(true);
  });

  test("WebSocketManager send message", () => {
    const manager = new WebSocketManager();
    const sent: string[] = [];
    const ws = {
      send: (msg: string) => sent.push(msg),
    } as any;

    manager.send(ws, ["EVENT", "sub1", { id: "1" }]);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual(["EVENT", "sub1", { id: "1" }]);
  });

  test("WebSocketManager getClients", () => {
    const manager = new WebSocketManager();
    const ws = { send: () => {} } as any;
    manager.addClient(ws);
    expect(manager.getClients()).toContain(ws);
  });

  test("WebSocketManager broadcast", () => {
    const manager = new WebSocketManager();
    const sent1: string[] = [];
    const sent2: string[] = [];

    const ws1 = {
      send: (msg: string) => sent1.push(msg),
      data: {
        subscriptions: new Map([["sub1", { filters: [{ kinds: [1] }] }]]),
      },
    } as any;

    const ws2 = {
      send: (msg: string) => sent2.push(msg),
      data: {
        subscriptions: new Map([["sub2", { filters: [{ kinds: [2] }] }]]),
      },
    } as any;

    manager.addClient(ws1);
    manager.addClient(ws2);

    const event1 = {
      kind: 1,
      id: "e1",
      created_at: 1000,
      pubkey: "p1",
      content: "",
      sig: "",
      tags: [],
    };
    const count = manager.broadcast(event1);

    expect(count).toBe(1);
    expect(sent1).toHaveLength(1);
    expect(sent2).toHaveLength(0);
    expect(JSON.parse(sent1[0]!)).toEqual(["EVENT", "sub1", event1]);
  });
});
