-- ============================================================================
-- koshi – Terminal-Native Decentralized SNS
-- Migration: v5.0.0 — stable prekey ids + refresh tokens
-- License: MIT
-- ============================================================================
-- Upgrades a database created before koshi v5 so that it matches the SQLite
-- implementation:
--
--   1. user_devices.one_time_pre_keys: TEXT[] -> JSONB
--      The column now stores `[{"id": 0, "publicKey": "<base64>"}, ...]`.
--      Every prekey keeps a stable id, so the server can report which
--      prekey it handed out (`preKeyId`) in the key bundle response.
--
--   2. refresh_tokens table
--      Stores the SHA-256 hash of a refresh token (never the raw token).
--
-- Safe to run multiple times — every statement is idempotent.
--
-- Usage:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-10-21_v5_prekey_ids_refresh_tokens.sql
--
-- Rollback:
--   DROP TABLE IF EXISTS refresh_tokens;
--   (the JSONB column cannot be losslessly converted back to TEXT[])
-- ============================================================================

-- Ensure UUID generation is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. one_time_pre_keys: TEXT[] -> JSONB
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
-- 2. refresh_tokens
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_hash  TEXT NOT NULL UNIQUE,      -- sha256 hex of the raw refresh token
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
