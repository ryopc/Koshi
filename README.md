# 🏄 koshi — Terminal-Native Decentralized SNS

**Version 0.2.0** · MIT License · by [game_ryo](https://github.com/ryopc)

> A terminal-native, decentralized social network powered by ed25519 cryptography.

---

## ✨ Features

- **🔐 Decentralized Auth** — ed25519 keypair authentication (Nostr-inspired)
- **📝 Posts** — Create and view posts on the koshi board
- **👥 Follow System** — Follow/unfollow other users
- **✉️ Direct Messages** — Signed, private DMs
- **📡 Real-time** — WebSocket-powered live updates
- **💻 Terminal-native** — Beautiful CLI with chalk colors and spinners
- **🐳 Docker-ready** — Containerized for easy deployment
- **☁️ Render.com** — One-click deploy to Render.com
- **🗄️ Neon.tech** — Serverless PostgreSQL 15 database

---

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [Server Setup](#server-setup)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Development](#development)
- [Security](#security)
- [License](#license)

---

## 🚀 Quick Start

```bash
# 1. Start the server (requires PostgreSQL)
DATABASE_URL=postgresql://user:pass@localhost:5432/koshi \
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
node bin/server.js

# 2. Register a new account
kb register alice

# 3. Post to the koshi board
kb post "Hello, koshi! 🌊"

# 4. View your feed
kb feed

# 5. Start the real-time stream
kb realtime
```

---

## 📦 Installation

### Global Install (CLI only)

```bash
# From npm (coming soon)
npm install -g @ryopc/koshi

# Or from source
git clone https://github.com/ryopc/koshi.git
cd koshi
npm install
npm link
```

### Dependencies

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 15.0 (hosted on [Neon.tech](https://neon.tech) in production)

---

## 💻 CLI Usage

The `kb` command is your gateway to the koshi board.

### Commands

| Command | Description |
|---------|-------------|
| `kb register <username>` | Create a new account with ed25519 keypair |
| `kb login <username>` | Authenticate using existing keypair |
| `kb whoami` | Show your profile information |
| `kb post <message>` | Create a new post on the koshi board |
| `kb feed [--limit=20]` | Display your post feed |
| `kb follow <username>` | Follow a user |
| `kb unfollow <username>` | Unfollow a user |
| `kb dm <username> <message>` | Send a direct message |
| `kb dms [--unread]` | View your direct messages |
| `kb profile [username]` | View a user profile |
| `kb search <query>` | Search users by username |
| `kb realtime` | Connect to the real-time event stream |
| `kb help [command]` | Show help |

### Examples

```bash
# Register a new user
kb register alice

# Login with existing keys
kb login alice

# Post something
kb post "Just joined koshi! 🌊"

# View feed
kb feed --limit=30

# Follow someone
kb follow bob

# Send a DM
kb dm bob "Hey, how's it going?"

# Search for users
kb search alice

# Live stream
kb realtime
```

### Configuration

Credentials are stored in `~/.config/koshi/config.json` and `~/.snsrc`.

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `KOSHI_API_URL` | `https://koshi-api.ryopc.f5.si` | API base URL |
| `KOSHI_WS_URL` | `wss://koshi-api.ryopc.f5.si` | WebSocket URL |

---

## 🖥️ Server Setup

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/ryopc/koshi.git
cd koshi
npm install

# 2. Set up PostgreSQL database
createdb koshi

# 3. Run database migrations
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/koshi \
JWT_SECRET=dev-secret-change-in-production \
node src/db/migrate.js

# 4. Start the server
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/koshi \
JWT_SECRET=dev-secret-change-in-production \
node bin/server.js
```

Or use the .env file:

```bash
cp .env.example .env
# Edit .env with your database credentials
npm run migrate
npm start
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret key for JWT signing |
| `PORT` | ❌ | Server port (default: 3000) |
| `NODE_ENV` | ❌ | `development` or `production` |
| `LOG_LEVEL` | ❌ | Log level (default: debug in dev, info in prod) |

---

## 📡 API Reference

### Base URL

Development: `http://localhost:3000/api`
Production: `https://koshi-api.ryopc.f5.si/api`

### Authentication

All authenticated endpoints require a JWT Bearer token:

```
Authorization: Bearer <token>
```

### Endpoints

#### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register a new user |
| POST | `/api/auth/login` | No | Login with signature |

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
| GET | `/api/posts/feed` | Optional | Get post feed |
| POST | `/api/posts` | Yes | Create a post |
| GET | `/api/posts/:id` | No | Get a single post |

#### DMs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dms` | Yes | Get DM inbox |
| POST | `/api/dms/:userId` | Yes | Send a DM |
| PUT | `/api/dms/:id/read` | Yes | Mark DM as read |
| GET | `/api/dms/unread/count` | Yes | Count unread DMs |

#### WebSocket

Connect: `ws://host:port/ws?token={jwt}`

Events: `message_sent`, `dm_received`, `user_online`, `user_offline`, `post_created`, `follow_notification`

#### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |

---

## ☁️ Deployment

### Render.com + Neon.tech (Recommended)

#### 1. Set up Neon.tech Database

1. Go to [Neon.tech](https://neon.tech) and create an account
2. Create a new project (PostgreSQL 15)
3. Get your connection string from **Connection Details** → `DATABASE_URL`
4. For production, use the **pooled connection string** (with `?pgbouncer=true`)

#### 2. Deploy on Render.com

1. Push this repo to GitHub
2. Go to [Render.com](https://render.com) and connect your GitHub repo
3. Render will auto-detect [`render.yaml`](render.yaml) (Blueprint) and create the service
4. In Render dashboard, add environment variables:
   - `DATABASE_URL` — your Neon.tech connection string
   - `JWT_SECRET` — generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. Render will auto-deploy on every push to `main`

#### Alternative: Manual Setup on Render

If you prefer not to use Blueprint:

1. Create a new **Web Service** on Render
2. Connect your GitHub repo
3. Configure:
   - **Name**: `koshi-api`
   - **Environment**: `Node`
   - **Build Command**: `npm ci`
   - **Start Command**: `node bin/server.js`
   - **Health Check Path**: `/api/health`
   - **Pre-Deploy Command**: `node src/db/migrate.js`
4. Add environment variables (see above)
5. Deploy!

### Docker

```bash
# Build the image
docker build -t koshi-api .

# Run the container
docker run -d \
  --name koshi-api \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e JWT_SECRET=... \
  koshi-api
```

### Docker Compose

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
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/koshi
      JWT_SECRET: change-this-in-production
    depends_on:
      - db

volumes:
  pgdata:
```

---

## 🔒 Security

- **Ed25519 Signatures** — All posts and DMs are signed for authenticity
- **JWT Auth** — Tokens expire after 24 hours
- **Rate Limiting** — Auth endpoints limited to 10 req/min per IP
- **SQL Injection Prevention** — Parameterized queries throughout
- **Input Validation** — All endpoints validate input
- **Helmet** — Security headers enabled
- **No Hardcoded Secrets** — Everything via environment variables
- **CORS** — Restricted to CLI client origins

---

## 🧪 Development

```bash
# Run tests
npm test

# Run linter
npm run lint

# Run with auto-reload
npm run dev

# Run migration
npm run migrate
```

### Project Structure

```
koshi/
├── bin/
│   ├── cli.js           # CLI/TUI entry point
│   └── server.js         # Express + WebSocket server
├── src/
│   ├── api/
│   │   ├── auth.js       # Auth routes (register/login)
│   │   ├── users.js      # User management routes
│   │   ├── posts.js      # Posts routes (koshi board)
│   │   └── dms.js        # Direct messages routes
│   ├── auth/
│   │   ├── ed25519.js    # Ed25519 crypto utilities
│   │   ├── jwt.js        # JWT token utilities
│   │   └── utils.js      # Hex encoding utilities
│   ├── db/
│   │   ├── schema.sql    # PostgreSQL schema
│   │   ├── migrate.js    # Migration script
│   │   └── pool.js       # Database connection pool
│   ├── middleware/
│   │   ├── auth.js       # Auth middleware
│   │   └── rateLimit.js  # Rate limiting middleware
│   ├── ws/
│   │   ├── index.js      # WebSocket server
│   │   └── handlers.js   # WebSocket message handlers
│   └── index.js          # Express app setup + logger
├── package.json
├── Dockerfile
├── render.yaml           # Render Blueprint (deployment config)
├── .env.example
└── .github/workflows/deploy.yml
```

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

## 🙏 Acknowledgments

- [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) — Pure JS ed25519 implementation
- [tweetnacl](https://tweetnacl.js.org/) — Cryptographic primitives
- [Ink](https://github.com/vadimdemedes/ink) — React for CLI
- [Chalk](https://github.com/chalk/chalk) — Terminal styling
- [Express](https://expressjs.com/) — Web framework
- [PostgreSQL](https://www.postgresql.org/) — Database
- [Render](https://render.com) — Cloud hosting
- [Neon](https://neon.tech) — Serverless PostgreSQL
