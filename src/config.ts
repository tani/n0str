import { type } from "arktype";
import * as fs from "node:fs";

/** Default relay configuration following NIP-11 specification. */
export const defaultRelayInfo = {
  name: "Nostra Relay",
  description: "A simple, reliable, and extensively tested Nostr relay.",
  pubkey: "bf2bee5281149c7c350f5d12ae32f514c7864ff10805182f4178538c2c421007",
  contact: "hi@example.com",
  supported_nips: [
    1, 2, 3, 5, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 22, 23, 25, 28, 33, 40, 42, 44, 45, 50, 51,
    57, 65, 78,
  ],
  software: "https://github.com/tani/nostra",
  version: "0.1.0",
  limitation: {
    max_message_length: 65536,
    max_subscriptions: 20,
    max_filters: 10,
    max_limit: 1000,
    max_subid_length: 64,
    min_pow_difficulty: 0,
    auth_required: false,
    payment_required: false,
    restricted_writes: false,
    created_at_lower_limit: 31536000,
    created_at_upper_limit: 3600,
  },
};

/** ArkType schema for validating relay information. */
export const RelayInfoSchema = type({
  "name?": "string",
  "description?": "string",
  "pubkey?": "string==64",
  "contact?": "string",
  "supported_nips?": "number[]",
  "software?": "string",
  "version?": "string",
  "limitation?": {
    "max_message_length?": "number>0",
    "max_subscriptions?": "number>0",
    "max_filters?": "number>0",
    "max_limit?": "number>0",
    "max_subid_length?": "number>0",
    "min_pow_difficulty?": "number>=0",
    "auth_required?": "boolean",
    "payment_required?": "boolean",
    "restricted_writes?": "boolean",
    "created_at_lower_limit?": "number>=0",
    "created_at_upper_limit?": "number>=0",
  },
});

/** Schema for parsing and validating relay information from a JSON string. */
export const RelayInfoFileSchema = type("string.json.parse").to(RelayInfoSchema);

/** Type definition for relay information inferred from the schema. */
export type RelayInfo = typeof RelayInfoSchema.infer;

/**
 * Loads relay information from a configuration file.
 * @param configPath - Path to the configuration file (default: "nostra.json").
 * @param logger - Logger instance for reporting status and errors.
 * @returns Combined relay information from default and loaded configuration.
 */
export function loadRelayInfo(configPath: string = "nostra.json", logger = console) {
  let loadedRelayInfo = defaultRelayInfo;

  if (fs.existsSync(configPath)) {
    const fileContent = fs.readFileSync(configPath, "utf-8");
    const out = RelayInfoFileSchema(fileContent);
    if (out instanceof type.errors) {
      logger.error("Invalid configuration in nostra.json:", out.summary);
    } else {
      loadedRelayInfo = {
        ...defaultRelayInfo,
        ...out,
        limitation: { ...defaultRelayInfo.limitation, ...out.limitation },
      };
      logger.log("Loaded configuration from nostra.json");
    }
  } else {
    logger.log("nostra.json not found, using default configuration");
  }

  return loadedRelayInfo;
}

/** Global relay configuration instance. */
export const relayInfo = loadRelayInfo();
