import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import * as fs from "node:fs";
import { defaultRelayInfo, loadRelayInfo } from "../../src/config/index.ts";

describe("config coverage", () => {
  test("invalid schema falls back to defaults", async () => {
    const configPath = resolve("n0str.invalid-schema.json");
    fs.writeFileSync(configPath, JSON.stringify({ name: 123 }), "utf8");
    const errors: unknown[] = [];
    const logs: unknown[] = [];

    const mockLogger = {
      error: (...args: any[]) => errors.push(args),
      info: (...args: any[]) => logs.push(args),
      debug: () => {},
      warn: () => {},
      trace: () => {},
    } as any;

    try {
      const loaded = loadRelayInfo(configPath, mockLogger);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(configPath);
    }
  });

  test("missing config uses defaults", async () => {
    const configPath = resolve("n0str.missing.json");
    const logs: unknown[] = [];

    const mockLogger = {
      error: () => {},
      info: (...args: any[]) => logs.push(args),
      debug: () => {},
      warn: () => {},
      trace: () => {},
    } as any;

    try {
      const loaded = loadRelayInfo(configPath, mockLogger);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      // Nothing to cleanup
    }
  });

  test("invalid JSON falls back to defaults", async () => {
    const configPath = resolve("n0str.invalid-json.json");
    fs.writeFileSync(configPath, "{ invalid json", "utf8");
    const errors: unknown[] = [];

    const mockLogger = {
      error: (...args: any[]) => errors.push(args),
      info: () => {},
      debug: () => {},
      warn: () => {},
      trace: () => {},
    } as any;

    try {
      const loaded = loadRelayInfo(configPath, mockLogger);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(configPath);
    }
  });

  test("valid config merges with defaults", async () => {
    const configPath = resolve("n0str.valid.json");
    const validConfig = {
      ...defaultRelayInfo,
      name: "Custom Relay",
    };
    fs.writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
    const logs: unknown[] = [];

    const mockLogger = {
      error: () => {},
      info: (...args: any[]) => logs.push(args),
      debug: () => {},
      warn: () => {},
      trace: () => {},
    } as any;

    try {
      const loaded = loadRelayInfo(configPath, mockLogger);
      expect(loaded.name).toBe("Custom Relay");
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(configPath);
    }
  });
});
