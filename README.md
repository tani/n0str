# Nostra

**Nostra** is a simple, reliable, and extensively tested [Nostr](https://github.com/nostr-protocol/nostr) relay implementation built on modern web technologies. Designed for simplicity and correctness, it leverages the power of **Bun**.

![License](https://img.shields.io/badge/license-AGPLv3-blue.svg)
![Bun](https://img.shields.io/badge/Bun-v1.3.5-black?logo=bun)
![NIPs](https://img.shields.io/badge/NIPs-29%20Supported-purple.svg)

## Features

- **Simplicity**: Codebase designed to be easy to understand and maintain.
- **Extensively Tested**: comprehensive test suite ensuring high coverage and NIP compliance.
- **Efficient Storage**: Uses **SQLite** with **Drizzle ORM** for reliable and type-safe database interactions.
- **Full-Text Search**: Native support for NIP-50 search capability using SQLite FTS5.
- **Configurable**: Easy configuration via `nostra.json`.
- **Secure**: Implements NIP-13 (PoW), NIP-22 (Event Limits), and NIP-42 (Authentication).
- **Type-Safe**: Fully typed with TypeScript.

## Supported NIPs

Nostra currently supports a wide range of Nostr Implementation Possibilities (NIPs):

| NIP | Description | Status |
| :--- | :--- | :--- |
| **01** | Basic Protocol Flow (EVENT, REQ, CLOSE) | Yes |
| **02** | Contact List and Petnames | Yes |
| **03** | OpenTimestamps Attestations | Yes |
| **04** | Encrypted Direct Message | Yes |
| **05** | Mapping Nostr keys to DNS-based internet identifiers | Yes |
| **09** | Event Deletion | Yes |
| **10** | On "e" and "p" tags in Text Events | Yes |
| **11** | Relay Information Document | Yes |
| **12** | Generic Tag Queries | Yes |
| **13** | Proof of Work | Yes |
| **15** | Nostr Marketplace | Yes |
| **16** | Event Treatment | Yes |
| **17** | Private Direct Messages | Yes |
| **18** | Reposts | Yes |
| **20** | Command Results | Yes |
| **22** | Event `created_at` Limits | Yes |
| **23** | Long-form Content | Yes |
| **25** | Reactions | Yes |
| **28** | Public Chat | Yes |
| **33** | Parameterized Replaceable Events | Yes |
| **40** | Expiration Timestamp | Yes |
| **42** | Authentication of Clients to Relays | Yes |
| **44** | Encrypted Payloads (Versioned) | Yes |
| **45** | Counting results | Yes |
| **50** | Search Capability | Yes |
| **51** | Lists | Yes |
| **57** | Lightning Zaps | Yes |
| **65** | Relay List Metadata | Yes |
| **78** | Application-specific Data | Yes |

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.3.5 or later)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/tani/nostra.git
   cd nostra
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

### Running the Relay

Start the relay server:

```bash
bun start
```

The relay will start listening on `ws://localhost:3000` (or the port defined in your configuration).

## Configuration

Nostra is configured via a `nostra.json` file in the root directory. If this file does not exist, default values will be used.

**Example `nostra.json`:**

```json
{
  "name": "My Custom Relay",
  "description": "My personal Nostr relay",
  "pubkey": "your-hex-pubkey-here",
  "contact": "admin@example.com",
  "limitation": {
    "max_message_length": 65536,
    "max_subscriptions": 20,
    "auth_required": false
  }
}
```

See the default configuration in `src/relay.ts` for all available options.

## Development

### Type Checking

```bash
bun typecheck
```

### Linting using OXLint

```bash
bun lint
```

### Formatting using OXFmt

```bash
bun format
```

### Testing

Run the test suite to verify functionality:

```bash
bun test
```

## License

AGPL