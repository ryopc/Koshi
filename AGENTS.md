# AGENTS.md

This guide provides common guidance for AI agents working in this workspace.

## Common Instructions

* All responses, explanations, agent thought processes, and output comments must be written in **English**.
* Do not respond in Japanese even if instructions are given in Japanese.

## Project Overview

**Koshi** - Terminal-native decentralized SNS
- Serverless P2P mesh (SQLite + hyperswarm)
- Post authentication with ed25519 signatures
- Designed for CLI/TUI operation
- v6: AI agent-friendly platform features

## Key Commands

```bash
# Development
npm run dev:cli          # CLI development with nodemon
npm run server:dev       # Local server development

# Test & Check
npm run lint             # Run ESLint
npm run test             # Run Jest

# Build
npm run build            # Run build script

# Spec Validation
node scripts/check-spec-parity.mjs     # Check OpenAPI spec and route parity
node scripts/check-schema-valid.mjs    # Validate JSON schemas
node scripts/check-agent-card.mjs      # Validate A2A Agent Card
```

## Development Flow

1. Add/modify features
2. Run `npm run lint`
3. Run spec validation scripts
4. Test locally if needed
   ```bash
   PORT=3001 node src/local/server-standalone.js &
   kb --local feed --json
   ```
5. Commit and push

## Important Files

| File | Role |
|------|------|
| `bin/cli.js` | CLI entry point (command dispatch) |
| `bin/kb-mcp.js` | MCP server (stdio transport) |
| `src/cli/args.js` | Command line argument parsing |
| `src/cli/output.js` | Output mode control (JSON/human readable) |
| `src/cli/exit.js` | Exit code management |
| `src/api/` | REST API implementation |
| `src/local/` | Serverless mode implementation |
| `src/mcp/` | MCP server implementation (tools/resources/prompts) |
| `src/spec/` | OpenAPI/JSON Schema definitions |
| `src/db/` | Database schema and migrations |

## CLI Design Principles

1. **Global flags first**: Parse `--json`, `--local`, `--quiet`, etc. first
2. **Command context**: Pass `commandContext = { global }` to all commands
3. **JSON mode**: In `--json` mode, use `ok()`/`fail()` for structured output
4. **Exit codes**: Use `ExitCode` enum for meaningful exit codes
5. **Auto help**: Use `handleHelp()` to display `--help`

## MCP Server

```bash
kb mcp    # Start with stdio transport
```

Available tools (17):
- `koshi_feed`, `koshi_post`, `koshi_get_post`
- `koshi_dm_send`, `koshi_dm_list`, `koshi_dm_read`
- `koshi_get_profile`, `koshi_edit_profile`, `koshi_search_users`
- `koshi_follow`, `koshi_unfollow`
- `koshi_groups_list`, `koshi_group_messages`, `koshi_group_send`
- `koshi_agent_directory`, `koshi_agent_card`, `koshi_watch`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `KOSHI_API_URL` | API base URL (override server URL) |
| `KOSHI_WS_URL` | WebSocket URL |
| `LOG_LEVEL` | debug/info/warn/error |

## Configuration File

Account info stored in `~/.config/koshi/config.json`:
- ed25519 key pairs per account
- JWT tokens
- Active account

## Known Constraints

- No binary generation tools (wasm, etc.)
- Avoid dependencies requiring WebAssembly
- Native build required for SQLite (`better-sqlite3`)
- P2P mode uses hyperswarm/DHT (NAT traversal automatic)
