import { args } from "./args.ts";

type LogFn = (msg: string | TemplateStringsArray, ...args: any[]) => void;

const LOG_LEVELS = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

function getCurrentLogLevel(): number {
  const envLevel = (args.logLevel ?? process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (envLevel && envLevel in LOG_LEVELS) {
    return LOG_LEVELS[envLevel as LogLevel];
  }
  return LOG_LEVELS.info;
}

function createLogFn(level: LogLevel): LogFn {
  const consoleMethod = level === "trace" ? "debug" : level;
  const levelPriority = LOG_LEVELS[level];

  return (msg: string | TemplateStringsArray, ...args: any[]) => {
    if (levelPriority < getCurrentLogLevel()) {
      return;
    }

    if (Array.isArray(msg) && (msg as any).raw) {
      const strings = msg as TemplateStringsArray;
      let result = "";
      for (let i = 0; i < strings.length; i++) {
        result += strings[i];
        if (i < args.length) {
          const val = args[i];
          if (val instanceof Error) {
            result += val.stack || val.message;
          } else if (typeof val === "object" && val !== null) {
            try {
              result += JSON.stringify(val);
            } catch {
              result += String(val);
            }
          } else {
            result += String(val);
          }
        }
      }
      console[consoleMethod](result);
    } else {
      console[consoleMethod](msg as string, ...args);
    }
  };
}

export const logger = {
  debug: createLogFn("debug"),
  info: createLogFn("info"),
  warn: createLogFn("warn"),
  error: createLogFn("error"),
  trace: createLogFn("trace"),
};
