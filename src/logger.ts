import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";

export async function setupLogger() {
  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: getPrettyFormatter(),
      }),
    },
    loggers: [
      { category: ["app"], sinks: ["console"], lowestLevel: "trace" },
      { category: ["nostr"], sinks: ["console"], lowestLevel: "trace" },
      {
        category: ["logtape", "meta"],
        sinks: ["console"],
        lowestLevel: "warning",
      },
    ],
  });
}

export const logger = getLogger(["app"]);
