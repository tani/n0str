import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: {
      type: "string",
      short: "p",
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
  database: ":memory:",
  dbEngine: (values.engine as string) || process.env.ENGINE || "sqlite",
  logLevel: (values["log-level"] as string) || process.env.LOGLEVEL || "info",
};

// Set environment variable for logger to pick up
if (config.logLevel) {
  process.env.LOGLEVEL = config.logLevel;
}
