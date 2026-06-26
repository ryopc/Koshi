# Koshi

**Koshi** — The terminal-first SNS built on ed25519 lattice cryptography.

Your public key is your identity. Your terminal is your home.

## Features

- 🔑 **Decentralized Identity**: ed25519 signature-based authentication (Nostr-inspired)
- 💻 **Terminal-Native**: Zero GUI, pure CLI experience
- ⚡ **Edge-Powered**: Cloudflare Workers + D1 backend
- 🔒 **Privacy-First**: Your secret key never leaves your machine
- ⏱️ **Replay Protection**: Timestamp-based request validation

## Installation

```bash
npm install -g @ryopc/koshi
```

## Quick Start

### 1. Initialize Your Keypair

```bash
koshi init
```

This generates your ed25519 keypair and stores it locally in `~/.snsrc`. Your secret key never leaves your machine.

Output:
