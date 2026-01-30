import { engines } from "./utils/engines.ts";
import { describe, test, expect, spyOn, beforeEach, afterEach, beforeAll } from "bun:test";
import { initRepository, getRepository } from "../src/db/repository.ts";
import { relayService } from "../src/services/server.ts";
import { logger, setLogLevel } from "../src/utils/logger.ts";

describe.each(engines)("Engine: %s > logger", () => {
  beforeAll(async () => {
    await initRepository(":memory:");
    relayService.setRepository(getRepository());
  });

  let debugSpy: any;
  let infoSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    setLogLevel("info");
    debugSpy = spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = spyOn(console, "info").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("debug logs", () => {
    setLogLevel("debug");
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
    setLogLevel("trace");
    void logger.trace`test`;
    expect(debugSpy).toHaveBeenCalled();
  });

  test("respects LOGLEVEL=info", () => {
    setLogLevel("info");

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
    setLogLevel("warn");

    void logger.info`info`;
    expect(infoSpy).not.toHaveBeenCalled();

    void logger.warn`warn`;
    expect(warnSpy).toHaveBeenCalled();
  });

  test("respects LOGLEVEL=error", () => {
    setLogLevel("error");

    void logger.warn`warn`;
    expect(warnSpy).not.toHaveBeenCalled();

    void logger.error`error`;
    expect(errorSpy).toHaveBeenCalled();
  });

  test("defaults to info if invalid", () => {
    setLogLevel("invalid" as any);

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
    expect(infoSpy).toHaveBeenCalledWith('[INFO] direct log {"foo":"bar"}');
  });
});
