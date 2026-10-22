#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Database Migration Script
// License: MIT
// ============================================================================
// Reads and executes src/db/schema.sql against the PostgreSQL database.
// Safe to run multiple times — all tables use IF NOT EXISTS.
//
// Usage (CLI):
//   node src/db/migrate.js
//   node src/db/migrate.js up
//   node src/db/migrate.js down
//
// Usage (programmatic):
//   import { runMigration, up, down } from './src/db/migrate.js';
//   await runMigration();
//   await up();
//   await down();
//
// Environment:
//   DATABASE_URL - PostgreSQL connection string (required)
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
import { logger } from '../logger.js';
import { V5_TABLES_SQL, V5_UPGRADE_SQL } from './v5Schema.js';

const { Pool } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// SQL for v6 Agent Platform additions
// ============================================================================
const V6_TABLES_SQL = `
-- ============================================
-- v6: AI Agent Platform Extensions
-- ============================================

-- Index for agent filtering
CREATE INDEX IF NOT EXISTS idx_users_is_agent ON users (is_agent) WHERE is_agent;

-- ============================================
-- Agent API Keys (hash stored, raw key shown once)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_api_keys (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash     TEXT NOT NULL UNIQUE,          -- sha256 hex
    key_prefix   VARCHAR(16) NOT NULL,          -- display prefix "ak_live_9f2a"
    scopes       JSONB NOT NULL DEFAULT '[]'::jsonb,
    label        VARCHAR(64),
    tier         VARCHAR(16) NOT NULL DEFAULT 'standard',  -- free | standard | trusted
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent ON agent_api_keys (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_api_keys_prefix ON agent_api_keys (key_prefix);

-- ============================================
-- Agent Events (SSE cursor resume + polling fallback)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_events (
    id         BIGSERIAL PRIMARY KEY,
    type       VARCHAR(48) NOT NULL,
    actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    target_id  UUID,
    payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_events_type_id ON agent_events (type, id DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_created  ON agent_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_actor    ON agent_events (actor_id);

-- ============================================
-- Agent Subscriptions (Webhook delivery)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_subscriptions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type  VARCHAR(48) NOT NULL,
    endpoint    VARCHAR(512) NOT NULL,
    secret_hash TEXT,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agent_id, event_type, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_agent_subscriptions_agent ON agent_subscriptions (agent_id);

-- ============================================
-- Mentions (for mention.received events)
-- ============================================
CREATE TABLE IF NOT EXISTS mentions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id          UUID NOT NULL REFERENCES kb_posts(id) ON DELETE CASCADE,
    mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id, mentioned_user_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions (mentioned_user_id);
`;

// Idempotent upgrade: ensure agent columns exist on users (for existing DBs)
const V6_UPGRADE_SQL = `
-- Add agent columns to users if not present (idempotent)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_agent           BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_kind         VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_version      VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_description  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_capabilities JSONB       NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_endpoint     VARCHAR(512);
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_callback_url VARCHAR(512);
CREATE INDEX IF NOT EXISTS idx_users_is_agent ON users (is_agent) WHERE is_agent;
`;

const V6_DOWN_SQL = `
-- Drop in reverse dependency order
DROP TABLE IF EXISTS mentions;
DROP TABLE IF EXISTS agent_subscriptions;
DROP TABLE IF EXISTS agent_events;
DROP TABLE IF EXISTS agent_api_keys;
DROP INDEX IF EXISTS idx_users_is_agent;
-- Note: users columns are NOT dropped to avoid data loss.
-- To fully revert, manual ALTER TABLE ... DROP COLUMN would be needed.
`;

// ============================================================================
// SQL for creating new tables (Phase 1 additions + v6)
// ============================================================================
const UP_SQL = `
-- ============================================
-- Groups & Group Messages (Pito Requirements)
-- ============================================

-- groups
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(128) NOT NULL,
    description TEXT,
    avatar_url VARCHAR(512),
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_e2ee BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON groups (created_by);

-- group_members
CREATE TABLE IF NOT EXISTS group_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members (user_id);

-- group_messages
CREATE TABLE IF NOT EXISTS group_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 5000),
    signature TEXT NOT NULL,
    message_type VARCHAR(16) NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'system')),
    reply_to UUID REFERENCES group_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group_created ON group_messages (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_sender_created ON group_messages (sender_id, created_at DESC);

-- message_read_receipts (1:1 DM + グループ共通)
CREATE TABLE IF NOT EXISTS message_read_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID NOT NULL,
    message_type VARCHAR(8) NOT NULL CHECK (message_type IN ('dm', 'group')),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (message_id, message_type, user_id)
);
CREATE INDEX IF NOT EXISTS idx_read_receipts_message ON message_read_receipts (message_id, message_type);
CREATE INDEX IF NOT EXISTS idx_read_receipts_user ON message_read_receipts (user_id);

-- ============================================
-- E2E: Device & Key Management (X3DH / Signal)
-- ============================================

-- group_session_keys (Sender Keys for group E2E)
CREATE TABLE IF NOT EXISTS group_session_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_key TEXT NOT NULL,             -- Sender Key (base64)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, sender_id)
);
CREATE INDEX IF NOT EXISTS idx_group_session_keys_group ON group_session_keys (group_id);

-- Apply updated_at trigger to groups
DROP TRIGGER IF EXISTS trg_groups_updated_at ON groups;
CREATE TRIGGER trg_groups_updated_at
    BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

${V5_TABLES_SQL}
${V6_TABLES_SQL}
`;

const DOWN_SQL = `
-- Drop in reverse dependency order
DROP TRIGGER IF EXISTS trg_groups_updated_at ON groups;
DROP TRIGGER IF EXISTS trg_push_tokens_updated_at ON push_tokens;
DROP TABLE IF EXISTS group_session_keys;
DROP TABLE IF EXISTS user_devices;
DROP TABLE IF EXISTS message_read_receipts;
DROP TABLE IF EXISTS group_messages;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS push_tokens;
DROP TABLE IF EXISTS refresh_tokens;
${V6_DOWN_SQL}
`;

// ============================================================================
// runMigration() — programmatic entry point
// ============================================================================
// Runs the schema migration against the database.
// Uses the project's logger if available, falls back to console.
// Safe to call multiple times (all CREATE statements use IF NOT EXISTS).
//
// Returns: { success: boolean, message: string }
// ============================================================================
export async function runMigration() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        const msg = 'DATABASE_URL environment variable is not set. Skipping migration.';
        logger.warn(msg);
        return { success: false, message: msg };
    }

    const pool = new Pool({ connectionString, connectionTimeoutMillis: 10000 });

    try {
        // Test connection
        await pool.query('SELECT NOW()');

        // Read schema file
        const schemaPath = join(__dirname, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf-8');

        // Execute schema (pg allows multi-statement queries)
        await pool.query(schema);

        // Apply the idempotent v5 upgrade blocks (TEXT[] -> JSONB prekeys,
        // per-user push token uniqueness). No-op on an up-to-date database.
        await pool.query(V5_UPGRADE_SQL);

        // Apply v6 agent platform upgrades (agent columns, new tables)
        await pool.query(V6_UPGRADE_SQL);

        const msg = 'Database migration completed. All tables and indexes are up to date.';
        logger.info(msg);
        return { success: true, message: msg };
    } catch (err) {
        const msg = `Database migration failed: ${err.message}`;
        logger.error({ err }, msg);
        return { success: false, message: msg };
    } finally {
        await pool.end();
    }
}

// ============================================================================
// up() — run only the new table creation (for incremental migrations)
// ============================================================================
export async function up() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        const msg = 'DATABASE_URL environment variable is not set.';
        logger.warn(msg);
        return { success: false, message: msg };
    }

    const pool = new Pool({ connectionString, connectionTimeoutMillis: 10000 });

    try {
        await pool.query('SELECT NOW()');
        await pool.query(UP_SQL);
        await pool.query(V5_UPGRADE_SQL);
        await pool.query(V6_UPGRADE_SQL);
        const msg = 'Migration up completed: groups, group_members, group_messages, message_read_receipts, user_devices, group_session_keys, agent_api_keys, agent_events, agent_subscriptions, mentions created; agent columns added to users.';
        logger.info(msg);
        return { success: true, message: msg };
    } catch (err) {
        const msg = `Migration up failed: ${err.message}`;
        logger.error({ err }, msg);
        return { success: false, message: msg };
    } finally {
        await pool.end();
    }
}

// ============================================================================
// down() — rollback new tables
// ============================================================================
export async function down() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        const msg = 'DATABASE_URL environment variable is not set.';
        logger.warn(msg);
        return { success: false, message: msg };
    }

    const pool = new Pool({ connectionString, connectionTimeoutMillis: 10000 });

    try {
        await pool.query('SELECT NOW()');
        await pool.query(DOWN_SQL);
        const msg = 'Migration down completed: new tables dropped.';
        logger.info(msg);
        return { success: true, message: msg };
    } catch (err) {
        const msg = `Migration down failed: ${err.message}`;
        logger.error({ err }, msg);
        return { success: false, message: msg };
    } finally {
        await pool.end();
    }
}

// ============================================================================
// CLI entry point (when run directly: node src/db/migrate.js)
// ============================================================================
async function main() {
    // Load .env file if present (development only)
    try {
        const dotenv = await import('dotenv');
        dotenv.config();
    } catch {
        // dotenv not available in production; that's fine
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('❌ FATAL: DATABASE_URL environment variable is not set.');
        console.error('   Set it to your PostgreSQL connection string.');
        console.error('   Example: postgresql://user:password@localhost:5432/koshi');
        process.exit(1);
    }

    const command = process.argv[2] || 'up';

    console.log(`📦 Connecting to database... (command: ${command})`);

    let result;
    if (command === 'up') {
        result = await up();
    } else if (command === 'down') {
        result = await down();
    } else {
        // Default: run full schema migration
        result = await runMigration();
    }

    if (result.success) {
        console.log(`   ${result.message}`);
        if (command !== 'down') {
            console.log('   Tables created: users, follows, kb_posts, dms, groups, group_members, group_messages, message_read_receipts, user_devices, group_session_keys, agent_api_keys, agent_events, agent_subscriptions, mentions');
            console.log('   Indexes created: username, public_key, follower/following, posts, dms, groups, devices, keys, agent filtering, agent_events, agent_subscriptions, mentions');
        }
        process.exit(0);
    } else {
        console.error(`   ${result.message}`);
        process.exit(1);
    }
}

import { isMainThread } from 'node:worker_threads';

// ファイルが直接実行された場合（node src/db/migrate.js）のみ main() を動かす
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
