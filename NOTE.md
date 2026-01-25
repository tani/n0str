# Progress Report

## Plan

- Implement NIP-01: Basic protocol flow
- Use Bun, SQLite, and nostr-tools
- Use Drizzle ORM for database layer
- Implement NIP-11: Relay Information Document
- Implement NIP-09: Event Deletion

## Status

- [x] Planning
- [x] NIP-01
  - [x] Project structure setup
  - [x] SQLite storage (Drizzle ORM)
  - [x] Relay core
  - [x] Message handling (Zod validation)
- [x] NIP-11: Relay Information Document
- [x] NIP-09: Event Deletion
- [x] NIP-40: Expiration
- [x] NIP-13: Proof of Work
- [x] NIP-01: Event Treatment (Ephemeral, Replaceable, Addressable)
- [x] Testing (Integration tests passing)

## NIP-11 Implementation Details

- Endpoint: `/` with `Accept: application/nostr+json`
- Supports metadata fields and CORS.

## NIP-09 Implementation Details

- Handles `kind 5` events.
- Supports deletion via `e` (ID) and `a` (replaceable) tags.
- Strict pubkey validation (only author can delete).

## Technology Stack

- Database: `nostra.db` (SQLite via Drizzle ORM)
- Server: `Bun.serve`
- Library: `nostr-tools`, `zod`
