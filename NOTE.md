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
- [x] NIP-01: Basic protocol flow description
- [x] NIP-02: Follow List
- [x] NIP-03: OpenTimestamps Attestations for Events
- [x] NIP-04: Encrypted Direct Message
- [x] NIP-05: Mapping Nostr keys to DNS-based internet identifiers
- [x] NIP-09: Event Deletion Request
- [x] NIP-10: Text Notes and Threads
- [x] NIP-11: Relay Information Document (with Limitation block)
- [x] NIP-12: Generic Tag Queries
- [x] NIP-13: Proof of Work
- [x] NIP-15: Nostr Marketplace
- [x] NIP-16: Event Treatment
- [x] NIP-17: Private Direct Messages (Gift Wrap)
- [x] NIP-18: Reposts
- [x] NIP-20: Command Results
- [x] NIP-22: Event Created_at Limits
- [x] NIP-23: Long-form Content
- [x] NIP-25: Reactions
- [x] NIP-28: Public Chat
- [x] NIP-33: Parameterized Replaceable Events
- [x] NIP-40: Expiration Timestamp
- [x] NIP-42: Authentication of clients to relays
- [x] NIP-44: Versioned Encrypted Payloads (Verification through storage)
- [x] NIP-45: Counting results
- [x] NIP-50: Search Capability
- [x] NIP-51: Lists
- [x] NIP-57: Lightning Zaps
- [x] NIP-65: Relay List Metadata
- [x] NIP-78: Application-specific Data
- [x] Testing (One file per NIP, coverage boosters expanded, Integration tests passing)

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
