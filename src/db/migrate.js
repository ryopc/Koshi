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

const { Pool } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// SQL for creating new tables (Phase 1 additions)
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

-- user_devices
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(64),
    identity_key TEXT NOT NULL,           -- X25519 public key (base64)
    signed_pre_key TEXT NOT NULL,         -- X25519 public key (base64)
    pre_key_signature TEXT NOT NULL,      -- ed25519 signature of signed_pre_key (base64)
    one_time_pre_keys TEXT[] NOT NULL DEFAULT '{}',  -- X25519 public keys (base64 array)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices (user_id);

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
`;

const DOWN_SQL = `
-- Drop in reverse dependency order
DROP TRIGGER IF EXISTS trg_groups_updated_at ON groups;
DROP TABLE IF EXISTS group_session_keys;
DROP TABLE IF EXISTS user_devices;
DROP TABLE IF EXISTS message_read_receipts;
DROP TABLE IF EXISTS group_messages;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
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
        const msg = 'Migration up completed: groups, group_members, group_messages, message_read_receipts, user_devices, group_session_keys created.';
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
            console.log('   Tables created: users, follows, kb_posts, dms, groups, group_members, group_messages, message_read_receipts, user_devices, group_session_keys');
            console.log('   Indexes created: username, public_key, follower/following, posts, dms, groups, devices, keys');
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
