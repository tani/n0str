import { expect, test, describe } from "bun:test";
import { relay } from "../src/server.ts";

describe("Reverse Proxy Header Support", () => {
  test("respects x-forwarded-proto and x-forwarded-host", async () => {
    let capturedData: any;
    const fakeServer = {
      upgrade: (req: Request, options: any) => {
        capturedData = options.data;
        return true;
      },
    };

    const req = new Request("http://localhost/path", {
      headers: {
        Upgrade: "websocket",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "n0str.tani.cc",
      },
    });

    relay.fetch(req, fakeServer);

    expect(capturedData).toBeDefined();
    // Protocol should be wss because x-forwarded-proto is https
    expect(capturedData.relayUrl).toBe("wss://n0str.tani.cc/path");
  });

  test("uses default values when headers are missing", async () => {
    let capturedData: any;
    const fakeServer = {
      upgrade: (req: Request, options: any) => {
        capturedData = options.data;
        return true;
      },
    };

    const req = new Request("http://localhost:3000/", {
      headers: {
        Upgrade: "websocket",
      },
    });

    relay.fetch(req, fakeServer);

    expect(capturedData).toBeDefined();
    expect(capturedData.relayUrl).toBe("ws://localhost:3000/");
  });

  test("handles x-forwarded-proto: http correctly", async () => {
    let capturedData: any;
    const fakeServer = {
      upgrade: (req: Request, options: any) => {
        capturedData = options.data;
        return true;
      },
    };

    const req = new Request("https://internal-load-balancer/path", {
      headers: {
        Upgrade: "websocket",
        "X-Forwarded-Proto": "http",
      },
    });

    relay.fetch(req, fakeServer);

    expect(capturedData.relayUrl).toBe("ws://internal-load-balancer/path");
  });

  test("handles x-forwarded-scheme correctly", async () => {
    let capturedData: any;
    const fakeServer = {
      upgrade: (req: Request, options: any) => {
        capturedData = options.data;
        return true;
      },
    };

    const req = new Request("http://localhost/path", {
      headers: {
        Upgrade: "websocket",
        "X-Forwarded-Scheme": "https",
      },
    });

    relay.fetch(req, fakeServer);

    expect(capturedData.relayUrl).toBe("wss://localhost/path");
  });

  test("getDisplayUrl normalizes trailing slash", async () => {
    const fakeServer = { upgrade: () => true };

    // relay.fetch for non-websocket/non-nip11 returns the display message
    const req = new Request("http://localhost:3000");
    const res = relay.fetch(req, fakeServer);
    const text = await res?.text();
    expect(text).toBe("n0str Relay (ws://localhost:3000/)");
  });
});
