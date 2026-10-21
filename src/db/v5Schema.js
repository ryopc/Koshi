#!/usr/bin/env node
// Shared SQL fragments for the koshi v5 schema.
//
// Kept in a dedicated module so that src/db/migrate.js and the standalone
// migration files stay in sync. (src/db/schema.sql is plain SQL and therefore
// carries a copy of the fresh-install DDL.)

/**
 * Fresh-install table definitions for the v5 objects.
 * (user_devices / push_tokens / refresh_tokens)
 */
export const V5_TABLES_SQL = `
-- ============================================================================
-- E2E: Device & Key Management (X3DH / Signal)
-- ============================================================================

-- user_devices
CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(64),
    identity_key TEXT NOT NULL,           -- X25519 public key (base64)
    signed_pre_key TEXT NOT NULL,         -- X25519 public key (base64)
    pre_key_signature TEXT NOT NULL,      -- XEdDSA signature of signed_pre_key (base64)
    one_time_pre_keys JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ id, publicKey }] (base64)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices (user_id);

-- ============================================================================
-- Push Notifications
-- ============================================================================

-- push_tokens
CREATE TABLE IF NOT EXISTS push_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expo_push_token TEXT NOT NULL,
    device_id TEXT,
    platform TEXT CHECK (platform IN ('ios', 'android')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, expo_push_token)
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_expo_push_token ON push_tokens(expo_push_token);

-- Apply updated_at trigger to push_tokens
DROP TRIGGER IF EXISTS trg_push_tokens_updated_at ON push_tokens;
CREATE TRIGGER trg_push_tokens_updated_at
    BEFORE UPDATE ON push_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Refresh Tokens (access token rotation)
-- ============================================================================

-- refresh_tokens — only the SHA-256 hash of a refresh token is stored.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_hash TEXT NOT NULL UNIQUE,      -- sha256 hex of the raw refresh token
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
`;

/**
 * Idempotent upgrade blocks for databases created before koshi v5.
 *
 * 1. user_devices.one_time_pre_keys: TEXT[] -> JSONB ({ id, publicKey })
 * 2. push_tokens: global UNIQUE(expo_push_token) -> UNIQUE(user_id, expo_push_token)
 *
 * Both blocks are no-ops once the database is already on the v5 shape, so it
 * is safe to run on every server start.
 */
export const V5_UPGRADE_SQL = `
-- ============================================================================
-- v5.0.0 upgrade: one-time prekeys become JSONB with stable ids
-- ============================================================================
-- Postgres does not allow a subquery inside an ALTER TYPE ... USING
-- expression, so the conversion is done by a helper function.
CREATE OR REPLACE FUNCTION koshi_prekeys_to_jsonb(arr text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
    SELECT COALESCE(
        jsonb_agg(jsonb_build_object('id', t.ord - 1, 'publicKey', t.key) ORDER BY t.ord),
        '[]'::jsonb
    )
    FROM unnest(arr) WITH ORDINALITY AS t(key, ord);
$fn$;

DO $upgrade$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_devices'
          AND column_name = 'one_time_pre_keys'
          AND data_type = 'ARRAY'
    ) THEN
        -- The legacy default ('{}'::text[]) cannot be cast to jsonb
        -- automatically, so it is dropped before the type change.
        EXECUTE $migrate$ ALTER TABLE user_devices ALTER COLUMN one_time_pre_keys DROP DEFAULT $migrate$;
        EXECUTE $migrate$
            ALTER TABLE user_devices
                ALTER COLUMN one_time_pre_keys TYPE JSONB
                USING koshi_prekeys_to_jsonb(one_time_pre_keys)
        $migrate$;
        EXECUTE $migrate$ ALTER TABLE user_devices ALTER COLUMN one_time_pre_keys SET DEFAULT '[]'::jsonb $migrate$;
    END IF;
END
$upgrade$;

DROP FUNCTION IF EXISTS koshi_prekeys_to_jsonb(text[]);

-- ============================================================================
-- v5.0.0 upgrade: push token uniqueness is per user, not global
-- ============================================================================
DO $upgrade$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('public.push_tokens')
          AND conname = 'push_tokens_expo_push_token_key'
    ) THEN
        EXECUTE $migrate$ ALTER TABLE push_tokens DROP CONSTRAINT push_tokens_expo_push_token_key $migrate$;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('public.push_tokens')
          AND conname = 'push_tokens_user_id_expo_push_token_key'
    ) THEN
        EXECUTE $migrate$ ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_user_id_expo_push_token_key UNIQUE (user_id, expo_push_token) $migrate$;
    END IF;
END
$upgrade$;
`;

export default { V5_TABLES_SQL, V5_UPGRADE_SQL };
