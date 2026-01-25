# Project Context: Nostra

## Project Overview

**Nostra** is a lightweight, reliable, and extensively tested **Nostr relay** implementation built on modern web technologies.

*   **Core Technology:** TypeScript, **Bun** runtime.
*   **Database:** **SQLite** with **Drizzle ORM** for type-safe and efficient storage.
*   **Key Features:**
    *   Full-Text Search (NIP-50) using SQLite FTS5.
    *   Comprehensive NIP support (see README for full list).
    *   Configurable via `nostra.json`.
    *   Implements security features like PoW (NIP-13) and Authentication (NIP-42).

## Building and Running

### Prerequisites
*   **Bun**: v1.3.5 or later (`bun --version`)

### Commands

*   **Install Dependencies:**
    ```bash
    bun install
    ```
*   **Start Relay:**
    ```bash
    bun start
    ```
    (Runs `src/index.ts`. Listens on `ws://localhost:3000` by default.)
*   **Run Tests:**
    ```bash
    bun test
    ```
*   **Type Check:**
    ```bash
    bun typecheck
    ```
*   **Lint:**
    ```bash
    bun lint
    ```
    (Uses `oxlint`)
*   **Format Code:**
    ```bash
    bun format
    ```
    (Uses `oxfmt`)

## Development Conventions

*   **Database Access:** All database logic is encapsulated in `src/db.ts` using Drizzle ORM.
*   **Schema:** Database schema is defined in `src/schema.ts`.
*   **Configuration:** The application reads from `nostra.json` at startup. Default configuration handling is likely in `src/relay.ts` or `src/init.ts`.
*   **Git Hooks:** The project uses `simple-git-hooks` to enforce formatting and linting on commit, and type-checking/testing on push.
*   **NIP Implementation:** Each supported NIP usually has corresponding logic in `src/` and tests in `test/` (e.g., `test/nip50.test.ts`).

## Key Files

*   `nostra.json`: Main configuration file (auto-generated or manually created).
*   `src/index.ts`: Application entry point.
*   `src/db.ts`: Database abstraction layer (save, query, delete events).
*   `src/schema.ts`: Drizzle ORM schema definitions.
*   `src/relay.ts`: Core relay logic and configuration types.
*   `test/`: Contains integration/unit tests for various NIPs.
