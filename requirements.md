You need to implement the simple but full-spec nostr relay based on NIP with following instruction

- implement NIPs as many as possible
- `nips/` are nostr requirements
- use `bun:sqlite3`
- use `Bun.serve` (`Bun.serve` supports websocket)
- use `nostr-tools`
- create `src/` for implementation
- create `test/` using `Bun.test`
  - comprehensive tests for each nips
  - coverage should be 100%
- for each function, you keep it as simple/small as possible. follow KISS priciple
- all data should be stored in sqlite3
- one NIP is implemented, then context compression should be proceeeded.
- write out the progress report to NOTE.md
