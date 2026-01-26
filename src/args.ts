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
    engine: {
      type: "string",
      short: "e",
    },
    "log-level": {
      type: "string",
      short: "l",
    },
  },
  strict: false,
  allowPositionals: true,
});

/**
 * Command-line and environment variable configuration for the relay.
 */
export const config = {
  port: parseInt((values.port as string) || process.env.PORT || "3000"),
  database: (values.database as string) || process.env.DATABASE_PATH || "n0str.db",
  dbEngine: (values.engine as string) || process.env.DATABASE_ENGINE || "sqlite",
  logLevel: (values["log-level"] as string) || process.env.LOG_LEVEL || "info",
};

// Set environment variable for logger to pick up
if (config.logLevel) {
  process.env.LOG_LEVEL = config.logLevel;
}
