import * as fs from "node:fs";
import { z } from "zod";

export const defaultRelayInfo = {
  name: "Nostra Relay",
  description: "A simple, reliable, and extensively tested Nostr relay.",
  pubkey: "bf2bee5281149c7c350f5d12ae32f514c7864ff10805182f4178538c2c421007",
  contact: "hi@example.com",
  supported_nips: [
    1, 2, 3, 5, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 22, 23, 25, 28, 33, 40,
    42, 44, 45, 50, 51, 57, 65, 78,
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

// Zod schemas for runtime validation
export const RelayInfoSchema = z.object({
  name: z.string(),
  description: z.string(),
  pubkey: z.string().length(64),
  contact: z.string().email().optional(),
  supported_nips: z.array(z.number()),
  software: z.string().url(),
  version: z.string(),
  limitation: z.object({
    max_message_length: z.number().int().positive(),
    max_subscriptions: z.number().int().positive(),
    max_filters: z.number().int().positive(),
    max_limit: z.number().int().positive(),
    max_subid_length: z.number().int().positive(),
    min_pow_difficulty: z.number().int().nonnegative(),
    auth_required: z.boolean(),
    payment_required: z.boolean(),
    restricted_writes: z.boolean(),
    created_at_lower_limit: z.number().int().nonnegative(),
    created_at_upper_limit: z.number().int().nonnegative(),
  }),
});

export function loadRelayInfo(
  configPath: string = "nostra.json",
  logger = console,
) {
  let loadedRelayInfo = defaultRelayInfo;

  try {
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, "utf-8");
      const rawConfig = JSON.parse(fileContent);
      const parsed = RelayInfoSchema.safeParse(rawConfig);
      if (!parsed.success) {
        logger.error(
          "Invalid configuration in nostra.json:",
          parsed.error.format(),
        );
        loadedRelayInfo = defaultRelayInfo;
      } else {
        loadedRelayInfo = { ...defaultRelayInfo, ...parsed.data };
        logger.log("Loaded configuration from nostra.json");
      }
    } else {
      logger.log("nostra.json not found, using default configuration");
    }
  } catch (e) {
    logger.error("Failed to load nostra.json:", e);
    loadedRelayInfo = defaultRelayInfo;
  }

  return loadedRelayInfo;
}

export const relayInfo = loadRelayInfo();
