type LogFn = (msg: string | TemplateStringsArray, ...args: any[]) => void;

function createLogFn(level: "debug" | "info" | "warn" | "error" | "trace"): LogFn {
  const consoleMethod = level === "trace" ? "debug" : level;
  return (msg: string | TemplateStringsArray, ...args: any[]) => {
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
