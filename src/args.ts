import { parseArgs } from "node:util";
import { relayInfo } from "./config.ts";

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
    loglevel: {
      type: "string",
      short: "l",
    },
    help: {
      type: "boolean",
      short: "h",
    },
    version: {
      type: "boolean",
      short: "v",
    },
  },
  strict: true,
  allowPositionals: false,
});

if (values.version) {
  console.log(`n0str v${relayInfo.version || "0.1.0"}`);
  process.exit(0);
}

if (values.help) {
  console.log(`
n0str - ${relayInfo.description || "A lightweight, reliable Nostr relay"}

Usage:
  n0str [options]

Options:
  -p, --port <number>      Port to listen on (default: 3000, env: PORT)
  -d, --database <path>    Database path or :memory: (default: :memory:, env: DATABASE)
  -l, --loglevel <level>  Log level: trace, debug, info, warn, error (default: info, env: LOGLEVEL)
  -h, --help               Show this help message
  -v, --version            Show version information

Configuration:
  Metadata and limitations can be configured via 'n0str.json'.
  Supported NIPs: ${relayInfo.supported_nips.join(", ")}.
  `);
  process.exit(0);
}

/**
 * Command-line and environment variable configuration for the relay.
 */
export const config = {
  port: parseInt((values.port as string) || process.env.PORT || "3000"),
  database: (values.database as string) || process.env.DATABASE || ":memory:",
  logLevel: (values.loglevel as string) || process.env.LOGLEVEL || "info",
};

// Set environment variable for logger to pick up
if (config.logLevel) {
  process.env.LOGLEVEL = config.logLevel;
}
