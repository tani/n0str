# Project Context: n0str

## Project Overview

**n0str** is a lightweight, reliable, and extensively tested **Nostr relay** implementation built on modern web technologies.

* **Core Technology:** TypeScript, **Bun** runtime.
* **Database:** **SQLite** (via `bun:sql`) for native performance and simplicity.
* **Key Features:**
  * Full-Text Search (NIP-50) using SQLite FTS5.
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

  (Runs `src/index.ts`. Listens on `ws://localhost:3000` by default.)

* **Run Tests:**

  ```bash
  bun test
  ```

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
  * `src/db.ts`: Initializes the SQLite connection and schema (including FTS5 triggers).
  * `src/repository.ts`: Encapsulates all data access logic (saving events, querying, NIP-09 deletion, NIP-40 expiration).
* **Logging:**
  * Uses `console` wrappers for logging.
  * **Style:** Use tagged template literals (e.g., `void logger.debug\`Message\``) or standard calls (e.g., `logger.info("Message")`).
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
* `src/index.ts`: Application entry point.
* `src/server.ts`: WebServer logic and routing (Bun.serve).
* `src/db.ts`: Database connection and schema initialization.
* `src/repository.ts`: Data Access Layer.
* `src/handlers/`: Request handlers for specific commands (EVENT, REQ, COUNT, etc.).
* `src/nostr.ts`: Nostr protocol utilities (validation, types).
* `src/logger.ts`: Logger implementation.
* `test/`: Contains integration/unit tests for various NIPs.
