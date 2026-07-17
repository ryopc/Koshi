// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Local SQLite Database Engine
// License: MIT
// ============================================================================
// Provides a local SQLite database that mirrors the PostgreSQL schema,
// enabling the CLI to work fully offline without a central server.
//
// All data is stored in ~/.config/koshi/local.db
// ============================================================================

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ============================================================================
// Constants
// ============================================================================
const LOCAL_DIR = join(homedir(), '.config', 'koshi');
const DB_PATH = join(LOCAL_DIR, 'local.db');

let _db = null;

// ============================================================================
// Database initialization
// ============================================================================

/**
 * Initialize the local SQLite database.
 * Creates the database file and runs migrations if needed.
 *
 * @returns {Database}
 */
export function initDB() {
    if (_db) return _db;

    // Ensure directory exists
    if (!existsSync(LOCAL_DIR)) {
        mkdirSync(LOCAL_DIR, { recursive: true });
    }

    _db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent performance
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');

    // Run migrations
    migrate();

    return _db;
}

/**
 * Get the database instance (must call initDB first).
 *
 * @returns {Database}
 */
export function getDB() {
    if (!_db) throw new Error('Database not initialized. Call initDB() first.');
    return _db;
}

/**
 * Close the database connection.
 */
export function closeDB() {
    if (_db) {
        _db.close();
        _db = null;
    }
}

// ============================================================================
// Schema & Migration
// ============================================================================

const SCHEMA = `
-- ============================================================================
-- 1. users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    public_key  TEXT UNIQUE NOT NULL,
    display_name TEXT,
    bio         TEXT,
    avatar_url  TEXT,
    is_admin    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_local_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_local_users_public_key ON users (public_key);

-- ============================================================================
-- 2. follows
-- ============================================================================
CREATE TABLE IF NOT EXISTS follows (
    id           TEXT PRIMARY KEY,
    follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_local_follows_follower ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_local_follows_following ON follows (following_id);

-- ============================================================================
-- 3. kb_posts
-- ============================================================================
CREATE TABLE IF NOT EXISTS kb_posts (
    id         TEXT PRIMARY KEY,
    author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 2000),
    signature  TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_local_posts_author ON kb_posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_posts_created ON kb_posts (created_at DESC);

-- ============================================================================
-- 4. dms
-- ============================================================================
CREATE TABLE IF NOT EXISTS dms (
    id           TEXT PRIMARY KEY,
    sender_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content      TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 5000),
    signature    TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'local',
    is_read      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_local_dms_recipient ON dms (recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_local_dms_sender ON dms (sender_id, created_at DESC);

-- ============================================================================
-- 5. p2p_peers (track known peers for sync)
-- ============================================================================
CREATE TABLE IF NOT EXISTS p2p_peers (
    id          TEXT PRIMARY KEY,
    username    TEXT,
    public_key  TEXT,
    last_seen   TEXT,
    peer_key    TEXT UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function migrate() {
    _db.exec(SCHEMA);
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Generate a UUID v4 for local use.
 */
export function generateId() {
    return randomUUID();
}

/**
 * Get the current timestamp as ISO string.
 */
export function now() {
    return new Date().toISOString();
}

/**
 * Wrap a database operation with error handling.
 * Returns a promise for consistency with the API layer.
 */
function wrap(fn) {
    try {
        const result = fn();
        return Promise.resolve(result);
    } catch (err) {
        return Promise.reject(err);
    }
}

// ============================================================================
// User operations
// ============================================================================

export const users = {
    /**
     * Create a new user.
     */
    create({ username, publicKey }) {
        return wrap(() => {
            const id = generateId();
            const stmt = _db.prepare(
                `INSERT INTO users (id, username, public_key) VALUES (?, ?, ?)`
            );
            stmt.run(id, username.toLowerCase().trim(), publicKey);
            return { id, username: username.toLowerCase().trim() };
        });
    },

    /**
     * Find a user by username.
     */
    findByUsername(username) {
        return wrap(() => {
            const stmt = _db.prepare('SELECT * FROM users WHERE username = ?');
            return stmt.get(username.toLowerCase().trim()) || null;
        });
    },

    /**
     * Find a user by public key.
     */
    findByPublicKey(publicKey) {
        return wrap(() => {
            const stmt = _db.prepare('SELECT * FROM users WHERE public_key = ?');
            return stmt.get(publicKey) || null;
        });
    },

    /**
     * Find a user by ID.
     */
    findById(id) {
        return wrap(() => {
            const stmt = _db.prepare('SELECT * FROM users WHERE id = ?');
            return stmt.get(id) || null;
        });
    },

    /**
     * Search users by username or display name.
     */
    search(query, limit = 20) {
        return wrap(() => {
            const stmt = _db.prepare(`
                SELECT id, username, display_name, avatar_url
                FROM users
                WHERE username LIKE ? OR display_name LIKE ?
                ORDER BY
                    CASE WHEN username LIKE ? THEN 0 ELSE 1 END,
                    username
                LIMIT ?
            `);
            const pattern = `%${query}%`;
            const prefix = `${query}%`;
            return stmt.all(pattern, pattern, prefix, limit);
        });
    },

    /**
     * Update user profile.
     */
    updateProfile(id, { displayName, bio, avatarUrl }) {
        return wrap(() => {
            const updates = [];
            const values = [];

            if (displayName !== undefined) {
                updates.push('display_name = ?');
                values.push(displayName.trim());
            }
            if (bio !== undefined) {
                updates.push('bio = ?');
                values.push(bio.trim());
            }
            if (avatarUrl !== undefined) {
                updates.push('avatar_url = ?');
                values.push(avatarUrl);
            }

            if (updates.length === 0) return null;

            updates.push("updated_at = datetime('now')");
            values.push(id);

            const stmt = _db.prepare(
                `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
            );
            stmt.run(...values);

            return _db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        });
    },

    /**
     * Get follower count for a user.
     */
    getFollowerCount(userId) {
        return wrap(() => {
            const stmt = _db.prepare(
                'SELECT COUNT(*) as count FROM follows WHERE following_id = ?'
            );
            return stmt.get(userId).count;
        });
    },

    /**
     * Get following count for a user.
     */
    getFollowingCount(userId) {
        return wrap(() => {
            const stmt = _db.prepare(
                'SELECT COUNT(*) as count FROM follows WHERE follower_id = ?'
            );
            return stmt.get(userId).count;
        });
    },

    /**
     * Get user profile with follower/following counts.
     */
    getProfile(username) {
        return wrap(() => {
            const user = this.findByUsername(username);
            if (!user) return null;

            const followersCount = this.getFollowerCount(user.id);
            const followingCount = this.getFollowingCount(user.id);

            return {
                ...user,
                followersCount,
                followingCount,
            };
        });
    },

    /**
     * Check if a user is following another.
     */
    isFollowing(followerId, followingId) {
        return wrap(() => {
            const stmt = _db.prepare(
                'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?'
            );
            return !!stmt.get(followerId, followingId);
        });
    },

    /**
     * Follow a user.
     */
    follow(followerId, followingId) {
        return wrap(() => {
            const id = generateId();
            const stmt = _db.prepare(
                'INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)'
            );
            stmt.run(id, followerId, followingId);
            return { success: true };
        });
    },

    /**
     * Unfollow a user.
     */
    unfollow(followerId, followingId) {
        return wrap(() => {
            const stmt = _db.prepare(
                'DELETE FROM follows WHERE follower_id = ? AND following_id = ?'
            );
            const info = stmt.run(followerId, followingId);
            return { success: info.changes > 0 };
        });
    },

    /**
     * Get a user's followers.
     */
    getFollowers(userId) {
        return wrap(() => {
            const stmt = _db.prepare(`
                SELECT u.id, u.username, u.display_name
                FROM follows f
                JOIN users u ON u.id = f.follower_id
                WHERE f.following_id = ?
                ORDER BY f.created_at DESC
            `);
            return stmt.all(userId);
        });
    },

    /**
     * Get who a user is following.
     */
    getFollowing(userId) {
        return wrap(() => {
            const stmt = _db.prepare(`
                SELECT u.id, u.username, u.display_name
                FROM follows f
                JOIN users u ON u.id = f.following_id
                WHERE f.follower_id = ?
                ORDER BY f.created_at DESC
            `);
            return stmt.all(userId);
        });
    },

    /**
     * List all users (admin).
     */
    listAll(limit = 50, offset = 0) {
        return wrap(() => {
            const stmt = _db.prepare(`
                SELECT u.*,
                    (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as followers_count,
                    (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count,
                    (SELECT COUNT(*) FROM kb_posts WHERE author_id = u.id) as posts_count
                FROM users u
                ORDER BY u.created_at DESC
                LIMIT ? OFFSET ?
            `);
            const countStmt = _db.prepare('SELECT COUNT(*) as total FROM users');
            return {
                users: stmt.all(limit, offset),
                total: countStmt.get().total,
            };
        });
    },

    /**
     * Delete a user (admin).
     */
    deleteById(id) {
        return wrap(() => {
            const stmt = _db.prepare('DELETE FROM users WHERE id = ?');
            stmt.run(id);
            return { success: true };
        });
    },

    /**
     * Set admin status.
     */
    setAdmin(id, isAdmin) {
        return wrap(() => {
            const stmt = _db.prepare('UPDATE users SET is_admin = ? WHERE id = ?');
            stmt.run(isAdmin ? 1 : 0, id);
            return _db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(id);
        });
    },
};

// ============================================================================
// Post operations
// ============================================================================

export const posts = {
    /**
     * Create a new post.
     */
    create({ authorId, content, signature, source = 'local', id }) {
        return wrap(() => {
            const postId = id || generateId();
            const stmt = _db.prepare(`
                INSERT INTO kb_posts (id, author_id, content, signature, source)
                VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(postId, authorId, content, signature, source);
            return { id: postId };
        });
    },

    /**
     * Get feed for a user (their posts + followed users' posts).
     * Falls back to global feed if no userId.
     */
    getFeed(userId = null, limit = 20, offset = 0) {
        return wrap(() => {
            let stmt;
            if (userId) {
                stmt = _db.prepare(`
                    SELECT
                        p.id, p.content, p.signature, p.created_at, p.source,
                        u.id as author_id, u.username as author_username, u.display_name as author_display_name
                    FROM kb_posts p
                    JOIN users u ON u.id = p.author_id
                    WHERE p.author_id = ?
                       OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
                    ORDER BY p.created_at DESC
                    LIMIT ? OFFSET ?
                `);
                return stmt.all(userId, userId, limit, offset).map(formatPost);
            } else {
                stmt = _db.prepare(`
                    SELECT
                        p.id, p.content, p.signature, p.created_at, p.source,
                        u.id as author_id, u.username as author_username, u.display_name as author_display_name
                    FROM kb_posts p
                    JOIN users u ON u.id = p.author_id
                    ORDER BY p.created_at DESC
                    LIMIT ? OFFSET ?
                `);
                return stmt.all(limit, offset).map(formatPost);
            }
        });
    },

    /**
     * Get a single post by ID.
     */
    getById(id) {
        return wrap(() => {
            const stmt = _db.prepare(`
                SELECT
                    p.id, p.content, p.signature, p.created_at, p.source,
                    u.id as author_id, u.username as author_username, u.display_name as author_display_name
                FROM kb_posts p
                JOIN users u ON u.id = p.author_id
                WHERE p.id = ?
            `);
            const row = stmt.get(id);
            return row ? formatPost(row) : null;
        });
    },

    /**
     * Get all posts (for P2P sync).
     */
    getAll() {
        return wrap(() => {
            const stmt = _db.prepare(`
                SELECT p.*, u.username as author_username
                FROM kb_posts p
                JOIN users u ON u.id = p.author_id
                ORDER BY p.created_at DESC
            `);
            return stmt.all();
        });
    },

    /**
     * Check if a post exists (by ID).
     */
    exists(id) {
        return wrap(() => {
            const stmt = _db.prepare('SELECT id FROM kb_posts WHERE id = ?');
            return !!stmt.get(id);
        });
    },
};

function formatPost(row) {
    return {
        id: row.id,
        author: {
            id: row.author_id,
            username: row.author_username,
            displayName: row.author_display_name,
        },
        content: row.content,
        signature: row.signature,
        source: row.source,
        createdAt: row.created_at,
    };
}

// ============================================================================
// DM operations
// ============================================================================

export const dms = {
    /**
     * Send a DM.
     */
    send({ senderId, recipientId, content, signature, source = 'local', id }) {
        return wrap(() => {
            const dmId = id || generateId();
            const stmt = _db.prepare(`
                INSERT INTO dms (id, sender_id, recipient_id, content, signature, source)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            stmt.run(dmId, senderId, recipientId, content, signature, source);
            return { id: dmId };
        });
    },

    /**
     * Get DMs for a user (sent + received).
     */
    getForUser(userId, limit = 50, offset = 0, unreadOnly = false) {
        return wrap(() => {
            let stmt;
            if (unreadOnly) {
                stmt = _db.prepare(`
                    SELECT
                        d.id, d.content, d.signature, d.is_read, d.created_at, d.source,
                        s.id as sender_id, s.username as sender_username, s.display_name as sender_display_name,
                        r.id as recipient_id, r.username as recipient_username, r.display_name as recipient_display_name
                    FROM dms d
                    JOIN users s ON s.id = d.sender_id
                    JOIN users r ON r.id = d.recipient_id
                    WHERE d.recipient_id = ? AND d.is_read = 0
                    ORDER BY d.created_at DESC
                    LIMIT ? OFFSET ?
                `);
            } else {
                stmt = _db.prepare(`
                    SELECT
                        d.id, d.content, d.signature, d.is_read, d.created_at, d.source,
                        s.id as sender_id, s.username as sender_username, s.display_name as sender_display_name,
                        r.id as recipient_id, r.username as recipient_username, r.display_name as recipient_display_name
                    FROM dms d
                    JOIN users s ON s.id = d.sender_id
                    JOIN users r ON r.id = d.recipient_id
                    WHERE d.recipient_id = ? OR d.sender_id = ?
                    ORDER BY d.created_at DESC
                    LIMIT ? OFFSET ?
                `);
            }
            const rows = unreadOnly
                ? stmt.all(userId, limit, offset)
                : stmt.all(userId, userId, limit, offset);
            return rows.map(formatDM);
        });
    },

    /**
     * Mark a DM as read.
     */
    markAsRead(dmId, userId) {
        return wrap(() => {
            const stmt = _db.prepare(
                'UPDATE dms SET is_read = 1 WHERE id = ? AND recipient_id = ?'
            );
            const info = stmt.run(dmId, userId);
            return { success: info.changes > 0 };
        });
    },

    /**
     * Get unread DM count.
     */
    getUnreadCount(userId) {
        return wrap(() => {
            const stmt = _db.prepare(
                'SELECT COUNT(*) as count FROM dms WHERE recipient_id = ? AND is_read = 0'
            );
            return stmt.get(userId).count;
        });
    },

    /**
     * Get all DMs (for P2P sync).
     */
    getAll() {
        return wrap(() => {
            const stmt = _db.prepare(`
                SELECT d.*, s.username as sender_username, r.username as recipient_username
                FROM dms d
                JOIN users s ON s.id = d.sender_id
                JOIN users r ON r.id = d.recipient_id
                ORDER BY d.created_at DESC
            `);
            return stmt.all();
        });
    },

    /**
     * Check if a DM exists (by ID).
     */
    exists(id) {
        return wrap(() => {
            const stmt = _db.prepare('SELECT id FROM dms WHERE id = ?');
            return !!stmt.get(id);
        });
    },
};

function formatDM(row) {
    return {
        id: row.id,
        from: {
            id: row.sender_id,
            username: row.sender_username,
            displayName: row.sender_display_name,
        },
        to: {
            id: row.recipient_id,
            username: row.recipient_username,
            displayName: row.recipient_display_name,
        },
        content: row.content,
        signature: row.signature,
        isRead: !!row.is_read,
        source: row.source,
        createdAt: row.created_at,
    };
}

// ============================================================================
// P2P Peer tracking
// ============================================================================

export const peers = {
    upsert({ peerKey, username, publicKey }) {
        return wrap(() => {
            const existing = _db.prepare('SELECT id FROM p2p_peers WHERE peer_key = ?').get(peerKey);
            if (existing) {
                const stmt = _db.prepare(
                    "UPDATE p2p_peers SET last_seen = datetime('now'), username = ?, public_key = ? WHERE peer_key = ?"
                );
                stmt.run(username || null, publicKey || null, peerKey);
            } else {
                const stmt = _db.prepare(`
                    INSERT INTO p2p_peers (id, username, public_key, last_seen, peer_key)
                    VALUES (?, ?, ?, datetime('now'), ?)
                `);
                stmt.run(generateId(), username || null, publicKey || null, peerKey);
            }
            return { success: true };
        });
    },

    list() {
        return wrap(() => {
            const stmt = _db.prepare('SELECT * FROM p2p_peers ORDER BY last_seen DESC');
            return stmt.all();
        });
    },
};

// ============================================================================
// Export
// ============================================================================
export default {
    initDB,
    getDB,
    closeDB,
    users,
    posts,
    dms,
    peers,
    generateId,
    now,
};
