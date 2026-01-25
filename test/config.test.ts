import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import * as fs from "node:fs";
import { defaultRelayInfo, loadRelayInfo } from "../src/config.ts";

describe("config coverage", () => {
  test("invalid schema falls back to defaults", async () => {
    const configPath = resolve("nostra.invalid-schema.json");
    fs.writeFileSync(configPath, JSON.stringify({ name: "bad-config" }), "utf8");
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args) => {
      errors.push(args);
    };
    try {
      const loaded = loadRelayInfo(configPath, console);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = originalError;
      fs.unlinkSync(configPath);
    }
  });

  test("missing config uses defaults", async () => {
    const configPath = resolve("nostra.missing.json");
    const logs: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args);
    };
    try {
      const loaded = loadRelayInfo(configPath, console);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
    }
  });

  test("invalid JSON falls back to defaults", async () => {
    const configPath = resolve("nostra.invalid-json.json");
    fs.writeFileSync(configPath, "{ invalid json", "utf8");
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args) => {
      errors.push(args);
    };
    try {
      const loaded = loadRelayInfo(configPath, console);
      expect(loaded).toEqual(defaultRelayInfo);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = originalError;
      fs.unlinkSync(configPath);
    }
  });

  test("valid config merges with defaults", async () => {
    const configPath = resolve("nostra.valid.json");
    const validConfig = {
      ...defaultRelayInfo,
      name: "Custom Relay",
    };
    fs.writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
    const logs: unknown[] = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args);
    };
    try {
      const loaded = loadRelayInfo(configPath, console);
      expect(loaded.name).toBe("Custom Relay");
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
      fs.unlinkSync(configPath);
    }
  });
});
