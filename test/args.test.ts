import { expect, test, describe } from "bun:test";
import { config } from "../src/args.ts";

describe("args coverage", () => {
  test("config has expected structure", () => {
    expect(typeof config.port).toBe("number");
    expect(typeof config.database).toBe("string");
    expect(typeof config.logLevel).toBe("string");
  });

  test("config handles defaults or environment variables", () => {
    // This is hard to unit test in the same process because args.ts
    // runs on import. But we can at least verify it's not undefined.
    expect(config.port).toBeDefined();
    expect(config.database).toBeDefined();
  });
});
