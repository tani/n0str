import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { logger } from "../src/logger";

describe("logger", () => {
  const originalEnv = process.env;
  let debugSpy: any;
  let infoSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    debugSpy = spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = spyOn(console, "info").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("debug logs", () => {
    process.env.LOG_LEVEL = "debug";
    void logger.debug`test`;
    expect(debugSpy).toHaveBeenCalled();
  });

  test("info logs", () => {
    void logger.info`test`;
    expect(infoSpy).toHaveBeenCalled();
  });

  test("warn logs", () => {
    void logger.warn`test`;
    expect(warnSpy).toHaveBeenCalled();
  });

  test("error logs", () => {
    void logger.error`test`;
    expect(errorSpy).toHaveBeenCalled();
  });

  test("trace logs to debug", () => {
    process.env.LOG_LEVEL = "trace";
    void logger.trace`test`;
    expect(debugSpy).toHaveBeenCalled();
  });

  test("respects LOG_LEVEL=info", () => {
    process.env.LOG_LEVEL = "info";

    void logger.trace`trace`;
    expect(debugSpy).not.toHaveBeenCalled(); // trace uses debug spy

    void logger.debug`debug`;
    expect(debugSpy).not.toHaveBeenCalled();

    void logger.info`info`;
    expect(infoSpy).toHaveBeenCalled();

    void logger.warn`warn`;
    expect(warnSpy).toHaveBeenCalled();

    void logger.error`error`;
    expect(errorSpy).toHaveBeenCalled();
  });

  test("respects LOG_LEVEL=warn", () => {
    process.env.LOG_LEVEL = "warn";

    void logger.info`info`;
    expect(infoSpy).not.toHaveBeenCalled();

    void logger.warn`warn`;
    expect(warnSpy).toHaveBeenCalled();
  });

  test("respects LOG_LEVEL=error", () => {
    process.env.LOG_LEVEL = "error";

    void logger.warn`warn`;
    expect(warnSpy).not.toHaveBeenCalled();

    void logger.error`error`;
    expect(errorSpy).toHaveBeenCalled();
  });

  test("defaults to info if invalid", () => {
    process.env.LOG_LEVEL = "invalid";

    void logger.debug`debug`;
    expect(debugSpy).not.toHaveBeenCalled();

    void logger.info`info`;
    expect(infoSpy).toHaveBeenCalled();
  });

  test("handles Error objects", () => {
    const err = new Error("test error");
    void logger.error`Got error: ${err}`;
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("test error"));
  });

  test("handles JSON objects", () => {
    const obj = { foo: "bar" };
    void logger.info`Data: ${obj}`;
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('{"foo":"bar"}'));
  });

  test("handles circular JSON objects", () => {
    const obj: any = { foo: "bar" };
    obj.self = obj;
    void logger.info`Data: ${obj}`;
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("[object Object]"));
  });

  test("handles direct log calls", () => {
    logger.info("direct log", { foo: "bar" });
    expect(infoSpy).toHaveBeenCalledWith("direct log", { foo: "bar" });
  });
});
