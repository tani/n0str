import { engines } from "./utils/engines.ts";
import { describe, test, expect, spyOn, beforeEach, afterEach, beforeAll } from "bun:test";
import { initRepository, getRepository } from "../src/repository.ts";
import { relayService } from "../src/server.ts";
import { logger } from "../src/logger.ts";

describe.each(engines)("Engine: %s > logger", (engine) => {
  beforeAll(async () => {
    await initRepository(engine, ":memory:");
    relayService.setRepository(getRepository());
  });

  const originalEnv = process.env;
  let debugSpy: any;
  let infoSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    delete process.env.LOGLEVEL;
    delete process.env.LOG_LEVEL;
    delete process.env.IGNORED_LOG_LEVEL;
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
    process.env.LOGLEVEL = "debug";
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
    process.env.LOGLEVEL = "trace";
    void logger.trace`test`;
    expect(debugSpy).toHaveBeenCalled();
  });

  test("respects LOGLEVEL=info", () => {
    process.env.LOGLEVEL = "info";

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

  test("respects LOGLEVEL=warn", () => {
    process.env.LOGLEVEL = "warn";

    void logger.info`info`;
    expect(infoSpy).not.toHaveBeenCalled();

    void logger.warn`warn`;
    expect(warnSpy).toHaveBeenCalled();
  });

  test("respects LOGLEVEL=error", () => {
    process.env.LOGLEVEL = "error";

    void logger.warn`warn`;
    expect(warnSpy).not.toHaveBeenCalled();

    void logger.error`error`;
    expect(errorSpy).toHaveBeenCalled();
  });

  test("defaults to info if invalid", () => {
    process.env.LOGLEVEL = "invalid";

    void logger.debug`debug`;
    expect(debugSpy).not.toHaveBeenCalled();

    void logger.info`info`;
    expect(infoSpy).toHaveBeenCalled();
  });

  test("does not fall back to old log level names", () => {
    process.env.LOG_LEVEL = "error";
    process.env.IGNORED_LOG_LEVEL = "error";
    void logger.debug`debug`;
    // Should use default 'info' and ignore other env vars
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
