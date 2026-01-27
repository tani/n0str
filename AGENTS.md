# Project Context: n0str

## Project Overview

**n0str** is a lightweight, reliable, and extensively tested **Nostr relay** implementation built on modern web technologies.

* **Core Technology:** TypeScript, **Bun** runtime.
* **Storage:** Support for **SQLite** (persistent or in-memory).
* **Key Features:**
  * Full-Text Search (NIP-50) with CJK support via `Intl.Segmenter`.
  * Comprehensive NIP support (see README for full list).
  * Configurable via `n0str.json`.
  * Implements security features like PoW (NIP-13) and Authentication (NIP-42).
  * **NIP-77** Negentropy Syncing support.
  * Extensible architecture with separated message handling, WebSocket management, and repository layers.

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

  (Runs tests using Bun's built-in test runner.)

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

* **Architecture:**
  * `NostrRelay` (`src/relay.ts`): Main service orchestrating WebSocket and message handling.
  * `NostrMessageHandler` (`src/message.ts`): Processes Nostr messages (EVENT, REQ, etc.) using ArkType `match`.
  * `WebSocketManager` (`src/websocket.ts`): Manages active WebSocket connections and broadcasting.
  * `IEventRepository` (`src/types.ts`): Interface for event persistence.
* **Database Access:**
  * `src/repository.ts`: Repository singleton and initialization logic.
  * `src/sqlite.ts`: SQLite backend implementation.
* **Configuration:**
  * Command-line arguments via `src/args.ts`.
  * Relay information and limits via `src/config.ts` (mapping to `n0str.json`).
* **Logging:**
  * Uses `console` wrappers via `src/logger.ts`.
  * **Style:** Prefer tagged template literals (e.g., `void logger.debug\`Message\``) for better integration with the logger.
  * **Levels:** `trace`, `debug`, `info`, `warn`, `error`.
* **Validation:**
  * Uses **ArkType** for schema validation and message matching.
* **Git Hooks:**
  * Uses `simple-git-hooks` to enforce formatting, linting, and testing.

## Key Files

* `n0str.json`: Configuration file for relay metadata and limitations.
* `index.ts`: Application entry point.
* `src/relay.ts`: Core relay service logic.
* `src/message.ts`: Nostr protocol message handler.
* `src/websocket.ts`: WebSocket connection management.
* `src/repository.ts`: Data Access Layer entry point.
* `src/sqlite.ts`: SQLite implementation for event storage.
* `src/fts.ts`: Full-text search indexing logic (using `Intl.Segmenter`).
* `src/language.ts`: Language detection for FTS.
* `src/nostr.ts`: Nostr protocol utilities and ArkType schemas.
* `src/logger.ts`: Logger implementation.
* `test/`: Comprehensive test suite for NIPs and core logic.
