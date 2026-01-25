import { describe, expect, test } from "bun:test";
import { handleReq } from "../src/handlers/req.ts";
import { relayInfo } from "../src/config.ts";

describe("handlers coverage", () => {
  test("handleReq enforces subscription limit", async () => {
    const sent: string[] = [];
    const ws = {
      send: (msg: string) => sent.push(msg),
      data: { subscriptions: new Map<string, any>() },
    } as any;
    for (let i = 0; i < relayInfo.limitation.max_subscriptions; i++) {
      ws.data.subscriptions.set(`sub-${i}`, []);
    }
    await handleReq(ws, ["sub", {}]);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("error: max subscriptions reached");
  });
});
