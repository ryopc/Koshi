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

-- Apply to kb_posts
DROP TRIGGER IF EXISTS trg_posts_updated_at ON kb_posts;
CREATE TRIGGER trg_posts_updated_at
    BEFORE UPDATE ON kb_posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
