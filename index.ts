import { relay } from "./src/relay.ts";

const server = Bun.serve(relay);

console.log(`Nostra relay listening on ws://localhost:${server.port}`);
