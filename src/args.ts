import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    database: {
      type: "string",
      short: "d",
    },
    port: {
      type: "string",
      short: "p",
    },
    "log-level": {
      type: "string",
      short: "l",
    },
  },
  strict: false,
});

export const args = {
  database: values.database,
  port: values.port,
  logLevel: values["log-level"],
};

export const config = {
  dbPath: args.database ?? process.env.DATABASE_PATH ?? "n0str.db",
  port: args.port ? parseInt(args.port) : (process.env.PORT ? parseInt(process.env.PORT) : 3000),
  logLevel: args.logLevel ?? process.env.LOG_LEVEL ?? "info",
};
