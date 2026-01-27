type LogFn = (msg: string | TemplateStringsArray, ...args: any[]) => void;

const LOGLEVELS = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
} as const;

type LogLevel = keyof typeof LOGLEVELS;

/**
 * Gets the current log level from environment variables.
 * @returns The numeric priority of the current log level.
 */
function getCurrentLogLevel(): number {
  const envLevel = process.env.LOGLEVEL?.toLowerCase();
  if (envLevel && envLevel in LOGLEVELS) {
    return LOGLEVELS[envLevel as LogLevel];
  }
  return LOGLEVELS.info;
}

/**
 * Creates a logging function for a specific log level.
 * Handles both string messages and tagged template literals.
 * @param level - The log level for the function.
 * @returns A logging function.
 */
function createLogFn(level: LogLevel): LogFn {
  const consoleMethod = level === "trace" ? "debug" : level;
  const levelPriority = LOGLEVELS[level];

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

/**
 * Global logger instance providing methods for different log levels.
 */
export const logger = {
  debug: createLogFn("debug"),
  info: createLogFn("info"),
  warn: createLogFn("warn"),
  error: createLogFn("error"),
  trace: createLogFn("trace"),
};
