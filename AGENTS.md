# Project Context: n0str

## Project Overview

**n0str** is a lightweight, reliable, and extensively tested **Nostr relay** implementation built on modern web technologies.

* **Core Technology:** TypeScript, **Bun** runtime.
* **Storage:** Support for **SQLite** (persistent or in-memory) and **PGLite** (PostgreSQL in WASM).
* **Key Features:**
  * Full-Text Search (NIP-50).
  * Comprehensive NIP support (see README for full list).
  * Configurable via `n0str.json`.
  * Implements security features like PoW (NIP-13) and Authentication (NIP-42).
  * **NIP-77** Negentropy Syncing support.

## Building and Running

### Prerequisites

* **Bun**: v1.3.5 or later (`bun --version`)

### Commands

* **Install Dependencies:**

  ```bash
  bun install
  ```

* **Start Relay:**

  ```bash
  bun start
  ```

  (Runs `index.ts`. Listens on `ws://localhost:3000` by default.)

* **Run Tests:**

  ```bash
  bun run test
  ```

  (Sequentially runs tests for both backends: `ENGINE=sqlite` and `ENGINE=pglite`)

* **Type Check:**

  ```bash
  bun typecheck
  ```

* **Lint:**

  ```bash
  bun lint
  ```

  (Uses `oxlint`)

* **Format Code:**

  ```bash
  bun format
  ```

  (Uses `oxfmt`)

* **Compile Binary:**

  ```bash
  bun run compile
  ```

  (Compiles binaries for Linux, macOS, and Windows.)

## Development Conventions

* **Database Access:**
  * `src/repository.ts`: Abstract storage layer.
  * `src/sqlite.ts`: SQLite backend implementation.
  * `src/pglite.ts`: PGLite (PostgreSQL) backend implementation.
* **Configuration:**
  * **DATABASE**: Path to the database or `:memory:` (default: `:memory:`).
  * **ENGINE**: `sqlite` or `pglite` (default: `sqlite`).
  * **PORT**: Relay port (default: `3000`).
  * **LOGLEVEL**: `trace`, `debug`, `info`, `warn`, `error` (default: `info`).
* **Logging:**
  * Uses `console` wrappers via `src/logger.ts`.
  * **Style:** Use tagged template literals (e.g., `void logger.debug\`Message\``) or standard calls (e.g., `logger.info("Message")`).
  * **Env:** Uses `LOGLEVEL` environment variable.
  * **Levels:**
    * `trace`: detailed per-message/per-query logs (mapped to `console.debug`).
    * `debug`: state changes, validation failures, client auth.
    * `info`: startup config, periodic maintenance summary.
    * `warn`: protocol violations, resource limits.
    * `error`: internal failures.
* **Configuration:** The application reads from `n0str.json` at startup using `src/config.ts`.
* **Git Hooks:** The project uses `simple-git-hooks` to enforce formatting and linting on commit, and type-checking/testing on push.

## Key Files

* `n0str.json`: Configuration file.
* `index.ts`: Application entry point.
* `src/server.ts`: WebServer logic and routing (Bun.serve).
* `src/sqlite.ts`: SQLite backend.
* `src/pglite.ts`: PGLite backend.
* `src/repository.ts`: Data Access Layer abstraction.
* `src/message.ts`: Request handler for commands (EVENT, REQ, COUNT, etc.).
* `src/nostr.ts`: Nostr protocol utilities (validation, types).
* `src/logger.ts`: Logger implementation.
* `test/`: Contains integration/unit tests for various NIPs.
