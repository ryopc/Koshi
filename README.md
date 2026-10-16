# 🏄 koshi — Terminal-Native Decentralized SNS

**Version 3.0.0** · MIT License · by [game_ryo](https://github.com/ryopc)

> A terminal-native, decentralized social network powered by ed25519 cryptography.
> **Serverless P2P mesh is the default** — no database or server setup needed. Just install and go.

---

## ✨ Features

### v3.1.2 — Serverless P2P Mesh (with Account Self-Deletion)

- **🏠 Serverless Mode (Default)** — Runs locally on your machine with SQLite + P2P mesh. No PostgreSQL required, no server setup needed.
- **🖧 P2P Gossip Network** — Posts, DMs, and profiles sync automatically across connected peers via hypercore + hyperswarm. No central server.
- **📡 Real-time Updates** — WebSocket-powered live feed and DM chat when running `kb serve`.
- **🔐 Decentralized Auth** — ed25519 keypair authentication (Nostr-inspired). Your keys, your identity.
- **🔑 Nostr Protocol Integration** — Generate/manage Nostr keys (nsec/npub), push koshi posts to Nostr relays, pull events from the Nostr network.
- **📝 Posts** — Create and view posts on the koshi board
- **👥 Follow System** — Follow/unfollow other users
- **✉️ End-to-End Encrypted DMs** — Private messages encrypted with x25519 (ed25519-derived) keys
- **💬 Interactive Chat** — LINE-style bubble chat UI in the terminal with real-time WebSocket
- **✏️ Profile Editing** — Update display name, bio, and avatar
- **🛠️ Admin Controls** — User management, account deletion, admin grants
- **💻 Terminal-native** — Beautiful CLI with chalk colors and ora spinners
- **🌐 Web UI** — React/Vite web frontend served by the local server
- **👥 Multi-Account Support** — Manage multiple koshi identities from a single CLI
- **🔌 Server Mode** — `kb connect` to a remote server (PostgreSQL-backed) for shared instances

### 🆕 New in v3.0

- **🖧 P2P Mesh (hypercore)** — Peer-to-peer data synchronization using hypercore + corestore + hyperswarm. Posts and DMs replicated across connected peers
- **💽 SQLite Local Database** — All data stored locally in `~/.config/koshi/local.db`. No external database needed.
- **`kb serve` Command** — Start a local serverless node (REST + WebSocket + Web UI + P2P)
- **`kb connect` Command** — Connect to a remote koshi server instead of using local mode
- **Multi-Account Support** — Manage multiple koshi identities from a single CLI. Switch between accounts with `kb switch`
- **Enhanced Config** — All credentials stored in `~/.config/koshi/config.json` with support for per-account Nostr keys and P2P settings

### v2.0 Features (Still Supported)

- **🔑 Nostr Protocol Integration** — Generate/manage Nostr keys, push/pull to/from Nostr relays
- **🖧 P2P Sync** — Peer-to-peer data synchronization (Node.js server/CLI mode)
- **👥 Multi-Account Support** — `kb switch` between accounts
- **⚙️ Enhanced Config** — `~/.config/koshi/config.json` with Nostr keys and P2P settings

---

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Server Mode](#server-mode-kb-serve--kb-connect)
- [Nostr Integration](#-nostr-integration)
- [P2P Architecture](#p2p-architecture-serverless-mesh)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Development](#development)
- [Security](#security)
- [License](#license)

---

## 🚀 Quick Start

### Serverless Mode (Default — No Setup Required)

```bash
# 1. Install from source
git clone https://github.com/ryopc/koshi.git
cd koshi
npm install

# 2. Link the CLI globally
npm link

# 3. Register and start posting (automatically uses local SQLite + P2P)
kb register alice
kb post "Hello, koshi! 🌊"

# 4. View your feed
kb feed

# 5. Start the local server (Web UI + Realtime WebSockets + P2P mesh)
kb serve
# Open http://localhost:3000 in your browser
```

### Connecting to a Remote Server

```bash
# Connect to a remote koshi server
kb connect https://koshi.ryopc.org
kb register bob        # Now registers on the remote server
kb post "Hello from remote!"
kb realtime            # Live stream of posts from the network
```

### Interactive DM Chat

```bash
# Search and start a real-time encrypted chat
kb chat                # Interactive: search → select user
kb chat bob            # Direct: chat with bob
# Type /exit to end the chat
```

---

## 📦 Installation

### From npm

```bash
npm install -g @ryopc/koshi
```

### From Source

```bash
git clone https://github.com/ryopc/koshi.git
cd koshi
npm install
npm link
```

### Dependencies

- **Node.js** >= 20.0.0 (requires native module support for `better-sqlite3`)

### Modes

| Mode | Database | P2P | Use Case |
|------|----------|-----|----------|
| **Serverless (default)** | SQLite (`~/.config/koshi/local.db`) | ✅ hypercore + hyperswarm | Offline-first, P2P gossip |
| **Server (remote)** | PostgreSQL | Optional | Shared multi-user instance |

---

## 💻 CLI Usage

The `kb` command is your gateway to the koshi board.

### Commands

| Command | Description |
|---------|-------------|
| `kb register <username>` | Create a new account with ed25519 keypair |
| `kb login <username>` | Authenticate using existing keypair (interactive) |
| `kb whoami` | Show your profile information |
| `kb post <message>` | Create a new post on the koshi board |
| `kb feed [--limit=20]` | Display your post feed |
| `kb follow <username>` | Follow a user (interactive search mode) |
| `kb unfollow <username>` | Unfollow a user |
| `kb dm <username> <message>` | Send an encrypted DM |
| `kb dms [--unread]` | View your DM inbox |
| `kb chat <username>` | Start an interactive real-time DM chat (bubble UI) |
| `kb edit-profile [--display-name=...]` | Update your own profile |
| `kb profile [username]` | View a user profile |
| `kb search <query>` | Search users by username |
| `kb realtime` | Stream real-time events |
| `kb accounts` | List all saved accounts |
| `kb switch [username]` | Switch active account (interactive) |
| `kb account remove <username>` | Delete a saved account from config |
| `kb delete [--force]` | Permanently delete your own account |
| `kb serve [--port=3000] [--daemon]` | Start local serverless node (REST+WS+Web+P2P) |
| `kb serve --stop` | Stop a background server started with `--daemon` |
| `kb connect <url>` | Connect to a remote server |
| `kb connect --reset` | Return to serverless mode |
| `kb connect --status` | Show current connection target |
| `kb nostr <command>` | Nostr integration (keys, relays, push/pull) |
| `kb p2p <command>` | P2P node management (status, sync, posts, dms) |
| `kb admin <command>` | Admin commands (users, delete-user, grant, revoke) |
| `kb help [command]` | Show help |

### Examples

```bash
# Register a new user (serverless by default)
kb register alice

# Post something
kb post "Just joined koshi! 🌊"

# Start a local serverless node
kb serve

# Connect to a remote server
kb connect https://koshi.ryopc.org

# Live stream
kb realtime

# Interactive DM chat with bubble TUI
kb chat

# Nostr key generation and relay management
kb nostr key generate
kb nostr relay add wss://relay.damus.io
kb nostr push
kb nostr pull
```

### Configuration

Credentials are stored in `~/.config/koshi/config.json`.

**Serverless mode is the default.** If no server URL is configured, koshi automatically uses local SQLite + P2P mesh.

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `KOSHI_API_URL` | `https://koshi.ryopc.org` | API base URL (overrides serverUrl config) |
| `KOSHI_WS_URL` | `wss://koshi.ryopc.org` | WebSocket URL (overrides serverUrl config) |
| `--local` | — | Force serverless mode flag |

---

## ⚙️ Server Mode (`kb serve` & `kb connect`)

### `kb serve` — Run a Local Serverless Node

Starts a local server with REST API + WebSocket + Web UI + P2P mesh. All data stored in local SQLite.

```bash
# Foreground (Ctrl+C to stop)
kb serve

# Custom port
kb serve --port=8080

# Background daemon
kb serve --daemon

# Stop background server
kb serve --stop
```

On startup, `kb serve` displays:

```
🖥️  koshi server — serverless P2P node
REST API:  http://127.0.0.1:3000
Web UI:    http://127.0.0.1:3000
WebSocket: ws://127.0.0.1:3000/ws?token=<token>
P2P Mesh:  active (3 peers)
```

### `kb connect` — Connect to a Remote Server

Switch between your local serverless node and a remote koshi server.

```bash
kb connect http://localhost:3000    # Connect to local kb serve
kb connect https://koshi.ryopc.org  # Connect to public server
kb connect --reset                  # Return to serverless mode
kb connect --status                 # Show current connection target
```

### Architecture: Serverless vs Remote

```
Serverless (default):
  kb register → ~/.config/koshi/local.db (SQLite)
  kb post     → P2P mesh broadcast (hyperswarm)
  kb serve    → REST + WebSocket + Web UI on 127.0.0.1:3000
  kb chat     → WebSocket to local serve

Remote (kb connect <url>):
  kb register → Remote PostgreSQL
  kb post     → Remote API
  kb realtime → WebSocket to remote server
```

---

## 🔑 Nostr Integration

koshi integrates with the Nostr protocol. You can generate Nostr keys, push posts to Nostr relays, and pull events from the Nostr network.

```bash
# Generate a Nostr keypair
kb nostr key generate

# Show your Nostr keys
kb nostr key show

# Manage relays
kb nostr relay list
kb nostr relay add wss://relay.damus.io
kb nostr relay test wss://relay.damus.io

# Cross-post koshi posts to Nostr
kb nostr push

# Pull Nostr events into koshi feed
kb nostr pull

# Show Nostr sync status
kb nostr status
```

---

## 🖧 P2P Architecture (Serverless Mesh)

### Overview

In serverless mode, koshi uses a decentralized P2P mesh network:

- **hypercore** — Append-only logs for posts, DMs, and profiles
- **corestore** — Manages multiple hypercore instances per node
- **hyperswarm** — P2P network discovery and connection management
- **ed2curve** — ed25519 → x25519 key conversion for DM encryption

### Topology

```
Global Board Topic (koshi:v1:board)
  ├── All nodes join this topic
  ├── Posts and profile announcements gossip here
  └── Discovery key shared across the mesh

Per-User Topic (koshi:v1:user:<pubkey>)
  ├── Individual users join their own topic
  ├── Direct DM delivery to connected peers
  └── E2E encrypted with x25519
```

### Data Flow

1. **Create**: Local API writes to SQLite + appends to P2P core
2. **Sync**: P2P bridge replicates to connected peers via corestore
3. **Discover**: New peers join topics, receive announce blocks
4. **Merge**: Bridge reconciles P2P data with local SQLite

### P2P Commands

```bash
kb p2p status    # Show P2P node status
kb p2p start     # Start P2P node manually
kb p2p stop      # Stop P2P node
kb p2p sync      # Show synced posts from the mesh
kb p2p dms       # Show synced DMs from the mesh
```

> **Note**: P2P requires Node.js (not available in browsers). Use `kb serve` + Web UI for browser-based access.

---

## 📡 API Reference

### Base URL

- **Serverless (local)**: `http://localhost:3000/api` (when running `kb serve`)
- **Remote**: Depends on `kb connect` target or `KOSHI_API_URL` env var

### Authentication

All authenticated endpoints require a JWT Bearer token:

```
Authorization: Bearer <token>
```

Tokens encode the `userId` and are signed with HMAC-SHA256 (24h expiry).

### Endpoints

#### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register with ed25519 public key |
| POST | `/api/auth/login` | No | Login with signed challenge |

#### Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/:username` | No | Get user profile |
| PUT | `/api/users/me` | Yes | Update own profile |
| GET | `/api/users/:id/followers` | No | Get followers |
| GET | `/api/users/:id/following` | No | Get following |
| POST | `/api/users/:id/follow` | Yes | Follow a user |
| DELETE | `/api/users/:id/follow` | Yes | Unfollow a user |
| GET | `/api/users/search/:query` | No | Search users |

#### Posts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/posts/feed` | Optional | Get post feed (personalized or global) |
| POST | `/api/posts` | Yes | Create a post |
| GET | `/api/posts/:id` | No | Get a single post |

#### DMs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms` | Yes | Get DM inbox |
| POST | `/api/dms/:userId` | Yes | Send a DM |
| PUT | `/api/dms/:id/read` | Yes | Mark DM as read |
| GET | `/api/dms/unread/count` | Yes | Count unread DMs |

#### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | Admin | List all users |
| GET | `/api/admin/users/:id` | Admin | Get user details |
| DELETE | `/api/admin/users/:id` | Admin | Permanently delete a user |
| PUT | `/api/admin/users/:id/admin` | Admin | Grant/revoke admin privileges |

> Admin: First registered user is admin in local mode. For remote servers, set `ADMIN_USERNAME` env var or `UPDATE users SET is_admin = TRUE WHERE username = '...';`

#### P2P

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/p2p/status` | No | Get P2P node status |
| GET | `/api/p2p/peers` | Yes | List connected peers |
| GET | `/api/p2p/posts` | Yes | Get P2P-synced posts |
| POST | `/api/p2p/sync` | Yes | Trigger manual sync |
| POST | `/api/p2p/start` | Yes | Start P2P node |
| POST | `/api/p2p/stop` | Yes | Stop P2P node |

#### WebSocket

Connect: `ws://host:port/ws?token={jwt}`

Events: `connected`, `post_created`, `dm_received`, `dm:sent`, `user_online`, `user_offline`, `post:created`, `error`

#### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |

---

## ☁️ Deployment

### Docker (Standalone — No External Dependencies) ✅ Recommended

**Use the pre-built image from GitHub Container Registry:**

```bash
# Pull and run (no build required)
docker run -d \
  --name koshi \
  -p 3000:3000 \
  -v $HOME/.config/koshi:/home/koshi/.config/koshi \
  ghcr.io/ryopc/koshi:standalone-v3.1.2
```

**Or build from source:**

```bash
# Build the standalone image
docker build --target standalone -t koshi:standalone .

# Run the container
docker run -d \
  --name koshi \
  -p 3000:3000 \
  -v $HOME/.config/koshi:/home/koshi/.config/koshi \
  koshi:standalone
```

The standalone server automatically creates a SQLite database at `~/.config/koshi/server.db` and runs REST API + WebSocket + Web UI + P2P mesh.

### Docker (PostgreSQL-backed Full Server)

```bash
# Pull the pre-built image from GHCR
docker pull ghcr.io/ryopc/koshi:runner-v3.1.2

# Or build from source
docker build --target runner -t koshi:full .

# Run with PostgreSQL (quote DATABASE_URL — & in query params breaks bash)
docker run -d \
  --name koshi-api \
  -p 3000:3000 \
  -e 'DATABASE_URL=postgresql://user:pass@db:5432/koshi' \
  -e 'JWT_SECRET=your-secret' \
  -e 'ADMIN_USERNAME=alice' \
  -e 'NODE_ENV=production' \
  ghcr.io/ryopc/koshi:runner-v3.1.2
```

### Docker Compose (PostgreSQL + API)

```yaml
version: '3.8'
services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: koshi
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build:
      context: .
      target: runner
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/koshi
      JWT_SECRET: change-this-in-production
      NODE_ENV: production
    depends_on:
      - db

volumes:
  pgdata:
```

### Render.com + Neon.tech

Deploy the PostgreSQL-backed server on Render with Neon as the database:

1. Go to [Neon.tech](https://neon.tech), create a project, get your `DATABASE_URL`
2. Go to [Render.com](https://render.com), connect your GitHub repo
3. Add environment variables:
   - `DATABASE_URL` — your Neon.tech connection string
   - `JWT_SECRET` — generate with: `openssl rand -base64 32`
4. Render auto-deploys on every push to `main`

### Self-Hosted Standalone

For a personal node with no external services:

```bash
# Just run the server (SQLite + P2P mesh, no config needed)
npm run server
# → http://localhost:3000
```

---

## 🧪 Development

```bash
# Install dependencies
npm install

# Run the CLI in dev mode (auto-reload)
npm run dev:cli

# Run the standalone server in dev mode
npm run server:dev

# Run tests (when implemented)
npm test

# Run linter
npm run lint

# Run migration (PostgreSQL mode only)
npm run migrate
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the CLI server (`kb serve`) |
| `npm run server` | Run the standalone server |
| `npm run server:dev` | Run standalone server with auto-reload |
| `npm run dev:cli` | Run CLI with auto-reload (nodemon) |
| `npm test` | Run tests |
| `npm run lint` | Run ESLint |
| `npm run migrate` | Run PostgreSQL migrations |

### Project Structure

```
koshi/
├── bin/
│   ├── cli.js              # CLI/TUI entry point (kb command)
│   └── server.js           # Express + WebSocket server (PostgreSQL mode)
├── src/
│   ├── api/
│   │   ├── auth.js         # Auth routes (register/login)
│   │   ├── users.js        # User management routes
│   │   ├── posts.js        # Posts routes (koshi board)
│   │   ├── dms.js          # Direct messages routes
│   │   ├── admin.js        # Admin routes (users, delete, grant)
│   │   └── p2p.js          # P2P API routes (web client bridge)
│   ├── auth/
│   │   ├── ed25519.js      # Ed25519 crypto utilities
│   │   ├── jwt.js          # JWT token utilities
│   │   ├── dh.js           # DM encryption (ed25519 → x25519 + nacl.box)
│   │   └── utils.js        # Hex encoding utilities
│   ├── config/
│   │   └── config.js       # Multi-account + Nostr + P2P config management
│   ├── db/
│   │   ├── schema.sql      # PostgreSQL schema
│   │   ├── migrate.js      # Migration script
│   │   └── pool.js         # Database connection pool
│   ├── local/
│   │   ├── db.js           # SQLite database engine
│   │   ├── api.js          # Local API (drop-in for remote API)
│   │   ├── server.js       # Local Express + WebSocket server
│   │   ├── p2p-bridge.js   # P2P ↔ SQLite sync bridge
│   └── server-standalone.js  # Fully self-contained SQLite server
│   ├── middleware/
│   │   ├── auth.js         # Auth middleware (requireAuth, requireAdmin)
│   │   └── rateLimit.js    # Rate limiting middleware
│   ├── nostr/
│   │   └── index.js        # Nostr protocol integration
│   ├── p2p/
│   │   └── index.js        # P2P mesh (hypercore + corestore + hyperswarm)
│   ├── ws/
│   │   ├── index.js        # WebSocket server
│   │   └── handlers.js     # WebSocket message handlers
│   └── index.js            # Express app setup + logger
├── client/                 # React web frontend (Vite + React 18)
├── web/                    # Built static files
├── package.json
├── Dockerfile
├── render.yaml             # Render Blueprint
├── .env.example
└── .github/workflows/      # CI/CD
```

---

## 🔒 Security

- **Ed25519 Signatures** — All posts and DMs are signed for authenticity
- **End-to-End DM Encryption** — DMs encrypted with x25519 keys derived from ed25519 keypairs
- **JWT Auth** — Tokens expire after 24 hours (HMAC-SHA256 in serverless, configurable in remote)
- **Admin Auth** — Admin-only endpoints protected by `requireAdmin` middleware
- **Rate Limiting** — Auth endpoints limited to 10 req/min per IP
- **SQL Injection Prevention** — Parameterized queries throughout
- **Input Validation** — All endpoints validate input (username format, content length, key format)
- **Helmet** — Security headers enabled
- **No Hardcoded Secrets** — Everything via environment variables
- **CORS** — Configurable per deployment
- **File Permissions** — Config files set to 0600 (owner read/write only)

---

## 📄 License & Copyright

### koshi (this project)

**Package:** `@ryopc/koshi`  
**Version:** `3.1.3`  
**Copyright:** © 2026 ryopc  
**License:** MIT

```
MIT License

Copyright (c) 2026 ryopc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Third-Party Dependencies

All runtime and development dependencies are under **permissive licenses** (MIT, Apache-2.0, ISC, BSD, Unlicense, Python-2.0, BlueOak-1.0.0). No copyleft licenses (GPL, AGPL, LGPL, MPL, SSPL, BSL) were detected, so the project's MIT declaration is not compromised.

| License | Packages | Nature |
|---------|----------|--------|
| MIT | ~306 | Permissive (highest compatibility) |
| Apache-2.0 | ~62 | Permissive (express patent grant) |
| ISC | ~31 | Permissive (MIT-like) |
| BSD-2-Clause / BSD-3-Clause | ~13 | Permissive |
| Unlicense | 3 | Public-domain-like |
| Python-2.0 | 1 | Permissive (attribution required) |
| BlueOak-1.0.0 | 1 | Permissive (modern) |

Notable direct dependencies:

| Package | License | Notes |
|---------|---------|-------|
| `@noble/ed25519`, `b4a`, `better-sqlite3`, `chalk`, `cors`, `corestore`, `express`, `helmet`, `hypercore`, `hyperswarm`, `ora`, `ws` | MIT | Permissive |
| `ed2curve`, `nostr-tools`, `tweetnacl` | Unlicense | Public-domain-like; legal uncertainty exists in some jurisdictions but is compatible with MIT in practice |
| `argparse` (transitive) | Python-2.0 | Permissive, attribution required |
| `minimatch` (transitive, under `nodemon`, dev-only) | BlueOak-1.0.0 | Permissive, not bundled in production |

> **Note:** `Unlicense` is close to the public domain and may carry legal uncertainty in certain jurisdictions. `Python-2.0` requires attribution. Neither is copyleft and both are compatible with MIT. See each package's `LICENSE` file for exact terms.

---

## 🙏 Acknowledgments

- [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) — Pure JS ed25519 implementation
- [tweetnacl](https://tweetnacl.js.org/) — Cryptographic primitives
- [ed2curve](https://github.com/dominictarr/ed2curve) — ed25519 to x25519 key conversion
- [Chalk](https://github.com/chalk/chalk) — Terminal styling
- [Ora](https://github.com/sindresorhus/ora) — Terminal spinners
- [Express](https://expressjs.com/) — Web framework
- [hypercore](https://github.com/hypercore-protocol/hypercore) — Append-only logs
- [corestore](https://github.com/hypercore-protocol/corestore) — Hypercore factory
- [hyperswarm](https://github.com/hypercore-protocol/hyperswarm) — P2P network discovery
- [nostr-tools](https://github.com/paulmillr/nostr-tools) — Nostr protocol library
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Fast SQLite bindings
- [PostgreSQL](https://www.postgresql.org/) — Database (remote server mode)