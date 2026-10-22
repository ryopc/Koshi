-- ============================================================================
-- koshi v6.0.0 — AIエージェントプラットフォーム拡張
-- Migration: 2026-10-21_v6_agent_platform
-- License: MIT
-- ============================================================================
-- 既存 users テーブルへの非破壊的列追加 + エージェント関連の新テーブル
-- PostgreSQL 版
-- ============================================================================

-- ============================================
-- 1. users テーブル拡張（既存行への破壊なし）
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_agent           BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_kind         VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_version      VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_description  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_capabilities JSONB       NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_endpoint     VARCHAR(512);
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_callback_url VARCHAR(512);

-- インデックス: エージェント検索用
CREATE INDEX IF NOT EXISTS idx_users_is_agent ON users (is_agent) WHERE is_agent;

-- ============================================
-- 2. エージェント API キー（ハッシュ保存）
-- ============================================
CREATE TABLE IF NOT EXISTS agent_api_keys (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash     TEXT NOT NULL UNIQUE,          -- sha256 hex
    key_prefix   VARCHAR(16) NOT NULL,          -- 表示用 "ak_live_9f2a"
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
-- 3. イベントログ（SSE カーソル再開・polling フォールバック用）
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
-- 4. Webhook 購読（エージェントが外部に push を受ける）
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
-- 5. メンション（mention.received イベント用）
-- ============================================
CREATE TABLE IF NOT EXISTS mentions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id          UUID NOT NULL REFERENCES kb_posts(id) ON DELETE CASCADE,
    mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id, mentioned_user_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions (mentioned_user_id);

-- ============================================
-- 6. users.updated_at トリガーへの agent_* 列追加対応
-- ============================================
-- 既存の update_updated_at_column() 関数は全列を対象にするため追加不要
-- groups テーブルのトリガーも既に存在