import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: {
      type: "string",
      short: "p",
    },
    database: {
      type: "string",
      short: "d",
    },
    "log-level": {
      type: "string",
      short: "l",
    },
  },
  strict: false,
  allowPositionals: true,
});

export const config = {
  port: parseInt(values.port || process.env.PORT || "3000"),
  database: values.database || process.env.DATABASE_PATH || "n0str.db",
  logLevel: values["log-level"] || process.env.LOG_LEVEL || "info",
};

// Set environment variable for logger to pick up
if (config.logLevel) {
  process.env.LOG_LEVEL = config.logLevel;
}
