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
  -p, --port <number>      Port to listen on (default: 3000)
  -d, --database <path>    Database path or :memory: (default: :memory:)
  -l, --loglevel <level>  Log level: trace, debug, info, warn, error (default: info)
  -h, --help               Show this help message
  -v, --version            Show version information

Configuration:
  Metadata and limitations can be configured via 'n0str.json'.
  Supported NIPs: ${relayInfo.supported_nips.join(", ")}.
  `);
  process.exit(0);
}

/**
 * Command-line configuration for the relay.
 */
export const config = {
  port: parseInt((values.port as string) || "3000"),
  database: (values.database as string) || ":memory:",
  logLevel: (values.loglevel as string) || "info",
};

// Set logger level
import { setLogLevel, type LogLevel } from "./logger.ts";
setLogLevel(config.logLevel as LogLevel);
