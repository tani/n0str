type LogFn = (msg: string | TemplateStringsArray, ...args: any[]) => void;

const LOGLEVELS = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
} as const;

export type LogLevel = keyof typeof LOGLEVELS;

let currentLogLevelPriority: number = LOGLEVELS.info;

/**
 * Sets the current log level.
 * @param level - The log level to set.
 */
export function setLogLevel(level: LogLevel): void {
  if (level in LOGLEVELS) {
    currentLogLevelPriority = LOGLEVELS[level];
  }
}

/**
 * Gets the current numeric log level priority.
 * @returns The numeric priority of the current log level.
 */
function getCurrentLogLevelPriority(): number {
  return currentLogLevelPriority;
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
    if (levelPriority < getCurrentLogLevelPriority()) {
      return;
    }

    let result = "";
    if (Array.isArray(msg) && (msg as any).raw) {
      const strings = msg as TemplateStringsArray;
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
    } else {
      result = msg as string;
      for (const arg of args) {
        if (arg instanceof Error) {
          result += " " + (arg.stack || arg.message);
        } else if (typeof arg === "object" && arg !== null) {
          try {
            result += " " + JSON.stringify(arg);
          } catch {
            result += " " + String(arg);
          }
        } else {
          result += " " + String(arg);
        }
      }
    }
    console[consoleMethod](`[${level.toUpperCase()}] ${result}`);
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

/**
 * Logs the current memory usage of the process.
 */
export function logMemoryUsage(context: string = "") {
  const used = process.memoryUsage();
  const format = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 100) / 100} MB`;
  void logger.debug`Memory Usage ${context}: RSS=${format(used.rss)}, HeapTotal=${format(
    used.heapTotal,
  )}, HeapUsed=${format(used.heapUsed)}, External=${format(used.external)}`;
}
