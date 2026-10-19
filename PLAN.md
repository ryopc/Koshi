---
status: in-progress
phase: 0
updated: 2026-10-19
---

# Implementation Plan

## Goal
Extend koshi (v3.1.7) as a platform backend for Pito (React Native/Expo messenger) by adding group chat, E2E key management, read receipts, and typing indicators — while maintaining P2P/serverless mode and PostgreSQL-first for new features.

## Context & Decisions
| Decision | Rationale | Source |
|----------|-----------|--------|
| TypeScript types in `src/types/index.ts` | Public API contract for client developers; enables `import { Group } from '@ryopc/koshi/types'` | User spec |
| PostgreSQL-only for new features | Groups, E2E keys, read receipts need relational integrity; P2P/SQLite mode documents as unsupported | User spec |
| Sender Keys for group E2E | MLS out of scope; Sender Keys simpler and migratable later | User spec |
| Server verifies signatures only | E2E decryption is client responsibility; server only relays and verifies ed25519 signatures | User spec |
| `message_read_receipts` unified table | Single table for both DM and group read receipts; message_type column distinguishes | User spec |
| Broadcast to group members via `broadcastToGroup` helper | Extends existing `broadcast` with group-aware delivery | User spec |

## Phase 0: Type Definitions & Shared Foundation [COMPLETE]
- [x] 0.1 Create `src/types/index.ts`
- [x] 0.2 Update `package.json` exports to include `./types`
- [x] 0.3 Verify i18n utilities work across all CLI commands

## Phase 1: Database Schema & Migration [COMPLETE]
- [x] 1.1 Extend `src/db/schema.sql` with groups, group_members, group_messages, message_read_receipts, user_devices, group_session_keys
- [x] 1.2 Extend `src/db/migrate.js` with up()/down() for new tables
- [x] 1.3 Update `src/local/db.js` SQLite schema for local mode parity

## Phase 2: REST API Endpoints [COMPLETE]
- [x] 2.1 Create `src/api/groups.js` (list, create, detail, update, delete, members, messages, read)
- [x] 2.2 Create `src/api/devices.js` (list, register, delete, get user devices)
- [x] 2.3 Create `src/api/keys.js` (get key bundle with one-time prekey consumption)
- [x] 2.4 Extend `src/api/dms.js` (read receipt → message_read_receipts + WS dm_read)
- [x] 2.5 Extend `src/api/users.js` (search, profile already exist; verify compatibility)
- [x] 2.6 Create `src/api/index.js` router integrating all endpoints

## Phase 3: WebSocket Handlers [COMPLETE]
- [x] 3.1 Extend `src/ws/handlers.js` with group, typing, key bundle handlers
- [x] 3.2 Add `broadcastToGroup` helper in `src/ws/index.js`
- [x] 3.3 Wire new handlers in `handleMessage` switch

## Phase 4: CLI Commands [COMPLETE]
- [x] 4.1 Add `cmdGroups` (list, create, delete, info)
- [x] 4.2 Add `cmdGroupMembers` (add, remove, list)
- [x] 4.3 Add `cmdDevices` (list, remove)
- [x] 4.4 Add `cmdKeys` (rotate, bundle)
- [x] 4.5 Add `cmdAdmin` (promote)
- [x] 4.6 Add `cmdConfig` (set)
- [x] 4.7 Integrate i18n for all new command messages

## Phase 5: Documentation [COMPLETE]
- [x] 5.1 Update `docs/index.html` landing page with new features & commands
- [x] 5.2 Update `docs/docs/index.html` detailed documentation with new endpoints
- [x] 5.3 Verify all docs reflect v4.0.0 platform extensions

## Notes
- 2026-10-19: Starting Phase 0 — type definitions first as they are the contract for all subsequent API work.
- Each phase should be verified before moving to next: migration runs, API returns 200/201, WS events fire, CLI commands execute.
- Existing functionality (DMs, posts, follows, P2P) must not regress.