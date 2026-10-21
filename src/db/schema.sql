-- ============================================================================
-- koshi – Terminal-Native Decentralized SNS
-- PostgreSQL Database Schema
-- License: MIT
-- ============================================================================
-- This schema defines the core data model for the koshi board:
--   users, follows, kb_posts (posts), and dms (direct messages).
-- All cryptographic operations use ed25519 keypairs for authentication
-- and message signing.
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username    VARCHAR(32) UNIQUE NOT NULL,
    public_key  TEXT UNIQUE NOT NULL,             -- ed25519 public key (hex-encoded)
    display_name VARCHAR(64),
    bio         TEXT,
    avatar_url  VARCHAR(512),
    is_admin    BOOLEAN NOT NULL DEFAULT FALSE,   -- admin privileges
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for fast username lookup (login / profile)
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- Index for public key lookup (authentication)
CREATE INDEX IF NOT EXISTS idx_users_public_key ON users (public_key);

-- ============================================================================
-- 2. follows
-- ============================================================================
CREATE TABLE IF NOT EXISTS follows (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (follower_id, following_id)
);

-- Index for fetching followers/following lists
CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows (following_id);

-- ============================================================================
-- 3. kb_posts (Koshi Board posts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS kb_posts (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 2000),
    signature  TEXT NOT NULL,                    -- ed25519 signature of content (hex-encoded)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Composite index for feed queries (ordered by time, filtered by author)
CREATE INDEX IF NOT EXISTS idx_posts_author_created ON kb_posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created ON kb_posts (created_at DESC);

-- Full-text search index for future search features
CREATE INDEX IF NOT EXISTS idx_posts_content_gin ON kb_posts USING gin (to_tsvector('english', content));

-- ============================================================================
-- 4. dms (Direct Messages)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dms (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content      TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 5000),
    signature    TEXT NOT NULL,                  -- ed25519 signature of content (hex-encoded)
    is_read      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for inbox queries (unread first, newest first)
CREATE INDEX IF NOT EXISTS idx_dms_recipient_read_created ON dms (recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dms_sender_created ON dms (sender_id, created_at DESC);

-- ============================================================================
-- 5. Helper function: updated_at trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to users
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. Seed: promote first registered user to admin (optional trigger)
--    Alternatively, set via: UPDATE users SET is_admin = TRUE WHERE username = 'adminusername';
-- ============================================================================
-- Admin is managed via API or direct DB update.
-- The first user can be made admin by setting the ADMIN_USERNAME env var.
-- See src/middleware/auth.js for how admin status is checked.

-- Apply to kb_posts
DROP TRIGGER IF EXISTS trg_posts_updated_at ON kb_posts;
CREATE TRIGGER trg_posts_updated_at
    BEFORE UPDATE ON kb_posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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
    pre_key_signature TEXT NOT NULL,      -- XEdDSA signature of signed_pre_key (base64)
    one_time_pre_keys JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ id, publicKey }] (base64)
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
