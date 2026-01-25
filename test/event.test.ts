import { describe, expect, test } from "bun:test";
import { handleEvent } from "../src/handlers/event.ts";

describe("handlers coverage", () => {
  test("handleEvent rejects malformed event", async () => {
    const sent: string[] = [];
    const ws = {
      send: (msg: string) => sent.push(msg),
      data: { subscriptions: new Map() },
    } as any;
    await handleEvent(ws, [{ bad: "event" }], new Set());
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("error: malformed event");
  });
});
