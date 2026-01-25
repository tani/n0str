import { relay } from "./src/server.ts";

const server = Bun.serve(relay);

console.log(`n0str relay listening on ws://localhost:${server.port}`);
