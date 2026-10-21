-- ============================================================================
-- koshi – Terminal-Native Decentralized SNS
-- Migration: Push Notifications (push_tokens)
-- License: MIT
-- ============================================================================
-- Standalone migration for databases created before the push notification
-- feature. Safe to run multiple times (all statements are idempotent).
--
-- Usage:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-10-20_push_tokens.sql
--
-- Rollback:
--   DROP TABLE IF EXISTS push_tokens;  -- cascades from users automatically
-- ============================================================================

-- Ensure UUID generation is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ensure the updated_at trigger helper exists (created in schema.sql §5).
-- Safe to re-create; it is identical to the canonical definition.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- push_tokens
-- ============================================================================
-- v5.0.0: the Expo token is unique per user (not globally), so one account
-- can never take over another account's push token.
CREATE TABLE IF NOT EXISTS push_tokens (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expo_push_token TEXT NOT NULL,
    device_id      TEXT,
    platform       TEXT CHECK (platform IN ('ios', 'android')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_expo_push_token ON push_tokens(expo_push_token);

-- Keep updated_at fresh on every update
DROP TRIGGER IF EXISTS trg_push_tokens_updated_at ON push_tokens;
CREATE TRIGGER trg_push_tokens_updated_at
    BEFORE UPDATE ON push_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- v5.0.0 upgrade: replace the legacy global UNIQUE(expo_push_token)
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
