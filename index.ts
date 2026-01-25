import { relay } from "./src/server.ts";

const server = Bun.serve(relay);

console.log(`Nostra relay listening on ws://localhost:${server.port}`);
