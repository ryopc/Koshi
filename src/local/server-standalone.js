#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Standalone Server (SQLite + Express + WebSocket)
// License: MIT
// ============================================================================
// A fully self-contained server that requires NO external database.
// Just run: node src/local/server-standalone.js
//
// Features:
//   - SQLite database (auto-created, no setup needed)
//   - Express REST API (full compatibility with koshi API)
//   - WebSocket for real-time updates
//   - Auto-migration on startup
//   - Web UI serving (if web/ directory exists)
//   - CORS enabled for cross-origin access
//
// Usage:
//   node src/local/server-standalone.js
//   PORT=8080 node src/local/server-standalone.js
//
// Environment:
//   PORT       - HTTP server port (default: 3000)
//   JWT_SECRET - Secret for JWT signing (auto-generated if not set)
// ============================================================================

import { createServer } from 'node:http';
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import nacl from 'tweetnacl';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Logger
// ============================================================================
const logger = {
    info: (obj, msg) => console.log(`[INFO] ${msg || ''}`, obj || ''),
    warn: (obj, msg) => console.warn(`[WARN] ${msg || ''}`, obj || ''),
    error: (obj, msg) => console.error(`[ERROR] ${msg || ''}`, obj || ''),
    debug: () => {},
};

// ============================================================================
// JWT (simplified HMAC-SHA256)
// ============================================================================
// v5.0.0: トークンに `exp`（有効期限）と `type`（access / refresh）を付与。
//   - access token : { userId, username, type: 'access', iat, exp }
//   - refresh token: { userId, username, type: 'refresh', iat, exp }
// `type` を持たない旧形式の access token も引き続き有効（後方互換）。
// refresh token を access token として使うことは拒否する。
// ============================================================================
const JWT_SECRET = process.env.JWT_SECRET || randomUUID();

const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;       // 24 hours
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days

function signToken(payload, options = {}) {
    const { type, expiresIn } = options;
    const now = Date.now();
    const claims = { ...payload, iat: now };
    if (type) claims.type = type;
    if (expiresIn) claims.exp = now + expiresIn;

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const data = `${header}.${body}`;
    const signature = createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
    return `${data}.${signature}`;
}

function verifyToken(token) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const [header, body, sig] = parts;
    const data = `${header}.${body}`;
    const expected = createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
    // Constant-time comparison (length mismatch is a signature mismatch)
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new Error('Invalid token signature');
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) throw new Error('Token expired');
    return payload;
}

/**
 * Hash a bearer token for storage. Raw tokens are never written to the DB.
 * @param {string} token
 * @returns {string} hex sha256 digest
 */
function hashToken(token) {
    return createHash('sha256').update(String(token)).digest('hex');
}

// ============================================================================
// ed25519 Signature Verification
// ============================================================================
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}

function verifyEd25519Signature(message, signatureHex, publicKeyHex) {
    try {
        const sigBytes = hexToBytes(signatureHex);
        const msgBytes = new TextEncoder().encode(message);
        const pkBytes = hexToBytes(publicKeyHex);
        return nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
    } catch {
        return false;
    }
}

// ============================================================================
// SQLite Database
// ============================================================================
const LOCAL_DIR = join(homedir(), '.config', 'koshi');
if (!existsSync(LOCAL_DIR)) mkdirSync(LOCAL_DIR, { recursive: true });

const DB_PATH = process.env.KOSHI_DB_PATH || join(LOCAL_DIR, 'server.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Auto-migrate
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        public_key TEXT UNIQUE NOT NULL,
        display_name TEXT,
        bio TEXT,
        avatar_url TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS follows (
        id TEXT PRIMARY KEY,
        follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (follower_id, following_id)
    );
    CREATE TABLE IF NOT EXISTS kb_posts (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 2000),
        signature TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dms (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 5000),
        signature TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================
    -- v5.0.0: X3DH devices, push tokens, refresh tokens
    -- ============================================

    -- X3DH デバイス（ユーザー単位に複数）
    CREATE TABLE IF NOT EXISTS user_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_name TEXT,
        identity_key TEXT NOT NULL,
        signed_pre_key TEXT NOT NULL,
        pre_key_signature TEXT NOT NULL,
        one_time_pre_keys TEXT NOT NULL DEFAULT '[]',   -- JSON 配列（{id, publicKey}）
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- プッシュ通知トークン
    CREATE TABLE IF NOT EXISTS push_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT,
        expo_push_token TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'android',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, expo_push_token)
    );

    -- リフレッシュトークン（失効管理）
    CREATE TABLE IF NOT EXISTS refresh_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
`);

logger.info({ path: DB_PATH }, 'Database ready');

// ============================================================================
// Helper: format rows
// ============================================================================
function formatPost(row) {
    return {
        id: row.id,
        author: { id: row.author_id, username: row.author_username, displayName: row.author_display_name },
        content: row.content,
        signature: row.signature,
        createdAt: toIso(row.created_at),
    };
}

function formatDM(row) {
    return {
        id: row.id,
        from: { id: row.sender_id, username: row.sender_username, displayName: row.sender_display_name },
        to: { id: row.recipient_id, username: row.recipient_username, displayName: row.recipient_display_name },
        content: row.content,
        signature: row.signature,
        isRead: !!row.is_read,
        createdAt: toIso(row.created_at),
    };
}

function generateId() {
    return randomUUID();
}

// ============================================================================
// Helpers: timestamps, base64, prekeys
// ============================================================================

/**
 * Normalize a SQLite timestamp ("YYYY-MM-DD HH:MM:SS", UTC) to ISO 8601.
 * Clients (React Native / Hermes) cannot reliably parse the SQLite format.
 * @param {string} value
 * @returns {string}
 */
function toIso(value) {
    if (typeof value !== 'string') return value;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        return `${value.replace(' ', 'T')}Z`;
    }
    return value;
}

// base64 (standard alphabet, with optional padding)
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Check that a string is base64 AND decodes to one of the given byte lengths.
 * The length check is what actually separates base64 from hex: a 64-char hex
 * string is a valid base64 *alphabet* string but decodes to 48 bytes, not 33.
 *
 * @param {string} value
 * @param {number[]} allowedLengths - accepted decoded byte lengths
 * @returns {boolean}
 */
function isBase64OfLength(value, allowedLengths) {
    if (typeof value !== 'string' || !BASE64_RE.test(value)) return false;
    let decoded;
    try {
        decoded = Buffer.from(value, 'base64');
    } catch {
        return false;
    }
    // Reject input that is not canonical base64 (Node's decoder is lenient).
    if (decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) return false;
    return allowedLengths.includes(decoded.length);
}

/**
 * Parse the stored one-time prekey list.
 * Accepts both the v5 format (`[{ id, publicKey }]`) and a plain string array.
 * @param {string} json
 * @returns {Array<{ id: number, publicKey: string }>}
 */
function parsePreKeys(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const out = [];
    parsed.forEach((entry, index) => {
        if (typeof entry === 'string') {
            out.push({ id: index, publicKey: entry });
        } else if (entry && typeof entry === 'object' && typeof entry.publicKey === 'string') {
            const id = Number.isInteger(entry.id) ? entry.id : index;
            out.push({ id, publicKey: entry.publicKey });
        }
    });
    return out;
}

/**
 * Serialize one-time prekeys, always as `[{ id, publicKey }]`.
 * @param {Array<{ id?: number, publicKey: string }>} keys
 * @returns {string}
 */
function serializePreKeys(keys) {
    return JSON.stringify(keys.map((k, index) => ({ id: Number.isInteger(k.id) ? k.id : index, publicKey: k.publicKey })));
}

/**
 * Format a device row for the API.
 * `id` is a numeric string ("3") because clients treat it as an opaque device id.
 * @param {object} row
 * @returns {object}
 */
function formatDevice(row) {
    return {
        id: String(row.id),
        userId: row.user_id,
        deviceName: row.device_name,
        identityKey: row.identity_key,
        signedPreKey: row.signed_pre_key,
        preKeySignature: row.pre_key_signature,
        oneTimePreKeys: parsePreKeys(row.one_time_pre_keys).map((k) => k.publicKey),
        createdAt: toIso(row.created_at),
        lastSeenAt: toIso(row.last_seen_at),
    };
}

/**
 * Issue a refresh token and persist its hash.
 * @param {string} userId
 * @param {string} username
 * @returns {string} the raw refresh token (returned to the client once)
 */
function issueRefreshToken(userId, username) {
    const token = signToken(
        // jti keeps every refresh token distinct, even when two are issued
        // for the same user within the same millisecond.
        { userId, username, jti: randomUUID() },
        { type: 'refresh', expiresIn: REFRESH_TOKEN_TTL_MS }
    );
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
    db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
        .run(hashToken(token), userId, expiresAt);
    return token;
}

/**
 * Remove a specific one-time prekey from a user's devices.
 * Used when the client reports which prekey it consumed.
 * @param {string} userId - owner of the devices
 * @param {number} preKeyId - id of the prekey to drop
 * @returns {boolean} true when a prekey was removed
 */
function consumePreKey(userId, preKeyId) {
    if (!Number.isInteger(preKeyId)) return false;
    const rows = db.prepare('SELECT id, one_time_pre_keys FROM user_devices WHERE user_id = ?').all(userId);
    for (const row of rows) {
        const preKeys = parsePreKeys(row.one_time_pre_keys);
        if (!preKeys.some((k) => k.id === preKeyId)) continue;
        const remaining = preKeys.filter((k) => k.id !== preKeyId);
        db.prepare('UPDATE user_devices SET one_time_pre_keys = ? WHERE id = ?')
            .run(serializePreKeys(remaining), row.id);
        return true;
    }
    return false;
}

// ============================================================================
// Auth Middleware
// ============================================================================
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const payload = verifyToken(authHeader.slice(7));
        // A refresh token must never be usable as an access token.
        if (payload.type === 'refresh') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        req.user = { userId: payload.userId, username: payload.username };
        next();
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

function extractUserId(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    try {
        return verifyToken(authHeader.slice(7)).userId;
    } catch {
        return null;
    }
}

// ============================================================================
// Express App
// ============================================================================
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '100kb' }));

// ---- Health ----
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'koshi-standalone', version: '5.0.0', mode: 'serverless-p2p', timestamp: new Date().toISOString() });
});

// ---- Auth: Register ----
app.post('/api/auth/register', (req, res) => {
    try {
        const { username, publicKey } = req.body;
        if (!username || !publicKey) return res.status(400).json({ error: 'Username and publicKey required' });
        const uname = username.trim().toLowerCase();
        if (!/^[a-z0-9_-]{3,32}$/.test(uname)) return res.status(400).json({ error: 'Invalid username format' });
        if (!/^[0-9a-f]{64}$/i.test(publicKey)) return res.status(400).json({ error: 'Invalid public key format' });
        if (db.prepare('SELECT id FROM users WHERE username = ?').get(uname)) return res.status(409).json({ error: 'Username already registered' });
        if (db.prepare('SELECT id FROM users WHERE public_key = ?').get(publicKey)) return res.status(409).json({ error: 'Public key already registered' });

        const id = generateId();
        db.prepare('INSERT INTO users (id, username, public_key) VALUES (?, ?, ?)').run(id, uname, publicKey);
        const token = signToken({ userId: id, username: uname }, { type: 'access', expiresIn: ACCESS_TOKEN_TTL_MS });
        const refreshToken = issueRefreshToken(id, uname);
        return res.status(201).json({ userId: id, token, refreshToken });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Auth: Login ----
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, signature } = req.body;
        if (!username || !signature) return res.status(400).json({ error: 'Username and signature required' });
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
        if (!user) return res.status(404).json({ error: 'User not found' });

        const challenge = `koshi:login:${user.username}`;
        if (!verifyEd25519Signature(challenge, signature, user.public_key)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const token = signToken({ userId: user.id, username: user.username }, { type: 'access', expiresIn: ACCESS_TOKEN_TTL_MS });
        const refreshToken = issueRefreshToken(user.id, user.username);
        return res.json({ token, userId: user.id, refreshToken });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Auth: Refresh ----
// Body: { refreshToken }
// → { token, refreshToken }  (refresh token はローテーションされる)
app.post('/api/auth/refresh', (req, res) => {
    try {
        const { refreshToken } = req.body || {};
        if (!refreshToken || typeof refreshToken !== 'string') {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(hashToken(refreshToken));
        if (!row || row.revoked) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        if (!row.expires_at || new Date(row.expires_at).getTime() <= Date.now()) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // The stored token must actually be a valid, unexpired refresh token
        // belonging to the same user.
        let payload;
        try {
            payload = verifyToken(refreshToken);
        } catch {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        if (payload.type !== 'refresh' || payload.userId !== row.user_id) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(row.user_id);
        if (!user) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // Rotate: revoke the old token, issue a new pair.
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(row.token);
        const token = signToken({ userId: user.id, username: user.username }, { type: 'access', expiresIn: ACCESS_TOKEN_TTL_MS });
        const newRefreshToken = issueRefreshToken(user.id, user.username);

        return res.json({ token, refreshToken: newRefreshToken });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Auth: Logout ----
// Revokes refresh tokens. Access tokens are stateless and are not revoked.
app.post('/api/auth/logout', (req, res) => {
    try {
        const bodyToken = req.body && req.body.refreshToken;
        if (bodyToken && typeof bodyToken === 'string') {
            db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(hashToken(bodyToken));
            return res.json({ success: true });
        }

        // Fallback: revoke every active refresh token of the authenticated user.
        const userId = extractUserId(req.headers.authorization);
        if (userId) {
            db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(userId);
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Search ----
app.get('/api/users/search/:query', (req, res) => {
    try {
        const q = `%${req.params.query}%`;
        const rows = db.prepare(`SELECT id, username, display_name, avatar_url FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY username LIMIT 20`).all(q, q);
        return res.json(rows.map(u => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url })));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Me ----
// IMPORTANT: must be registered BEFORE /api/users/:username so that
// "me" is not captured by the :username parameter.
app.get('/api/users/me', requireAuth, (req, res) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const followersCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(user.id).c;
        const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(user.id).c;
        return res.json({
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            bio: user.bio,
            avatarUrl: user.avatar_url,
            publicKey: user.public_key,
            isAdmin: !!user.is_admin,
            followersCount,
            followingCount,
            createdAt: toIso(user.created_at),
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Profile ----
app.get('/api/users/:username', (req, res) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username.trim().toLowerCase());
        if (!user) return res.status(404).json({ error: 'User not found' });
        const followersCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(user.id).c;
        const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(user.id).c;
        return res.json({
            id: user.id, username: user.username, displayName: user.display_name,
            bio: user.bio, avatarUrl: user.avatar_url,
            // ed25519 公開鍵（hex 64 文字）。クライアントは受信 DM の署名検証に使う。
            publicKey: user.public_key,
            isAdmin: !!user.is_admin,
            followersCount, followingCount, createdAt: toIso(user.created_at),
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Update Profile ----
app.put('/api/users/me', requireAuth, (req, res) => {
    try {
        const { displayName, bio, avatarUrl } = req.body;
        const updates = [];
        const values = [];
        if (displayName !== undefined) { updates.push('display_name = ?'); values.push(displayName.trim()); }
        if (bio !== undefined) { updates.push('bio = ?'); values.push(bio.trim()); }
        if (avatarUrl !== undefined) { updates.push('avatar_url = ?'); values.push(avatarUrl); }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
        updates.push("updated_at = datetime('now')");
        values.push(req.user.userId);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
        return res.json({ id: user.id, username: user.username, displayName: user.display_name, bio: user.bio, avatarUrl: user.avatar_url });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Self-delete account ----
app.delete('/api/users/me', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const username = req.user.username;
        // Delete all associated data first (SQLite has limited CASCADE support)
        db.prepare('DELETE FROM kb_posts WHERE author_id = ?').run(userId);
        db.prepare('DELETE FROM dms WHERE sender_id = ? OR recipient_id = ?').run(userId, userId);
        db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(userId, userId);
        db.prepare('DELETE FROM user_devices WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM push_tokens WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
        // Delete the user
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
        return res.json({ success: true, message: `Account @${username} has been permanently deleted.` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Push Token (register) ----
// Body: { expoPushToken, deviceId? }
// `deviceId` は POST /api/devices で発行されたサーバ発行デバイス ID。
app.post('/api/users/me/push-token', requireAuth, (req, res) => {
    try {
        const { expoPushToken, deviceId } = req.body || {};
        if (!expoPushToken || typeof expoPushToken !== 'string') {
            return res.status(400).json({ error: 'expoPushToken is required' });
        }
        if (!/^ExponentPushToken\[[A-Za-z0-9_-]{8,}\]$/.test(expoPushToken)) {
            return res.status(400).json({
                error: 'Invalid Expo push token format',
                message: 'Token must look like "ExponentPushToken[<payload>]".',
            });
        }
        if (deviceId !== undefined && deviceId !== null && typeof deviceId !== 'string' && typeof deviceId !== 'number') {
            return res.status(400).json({ error: 'deviceId must be a string' });
        }

        const deviceIdStr = deviceId === undefined || deviceId === null ? null : String(deviceId);

        // Same (user, token) pair is overwritten in place.
        db.prepare(`
            INSERT INTO push_tokens (user_id, device_id, expo_push_token)
            VALUES (?, ?, ?)
            ON CONFLICT (user_id, expo_push_token) DO UPDATE SET
                device_id = COALESCE(excluded.device_id, push_tokens.device_id),
                updated_at = datetime('now')
        `).run(req.user.userId, deviceIdStr, expoPushToken);

        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Push Token (unregister) ----
// Body (optional): { expoPushToken } or { deviceId } — body なしで全件削除。
app.delete('/api/users/me/push-token', requireAuth, (req, res) => {
    try {
        const body = req.body || {};
        const userId = req.user.userId;

        if (typeof body.expoPushToken === 'string' && body.expoPushToken.length > 0) {
            db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND expo_push_token = ?')
                .run(userId, body.expoPushToken);
            return res.json({ success: true });
        }
        if (body.deviceId !== undefined && body.deviceId !== null) {
            db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND device_id = ?')
                .run(userId, String(body.deviceId));
            return res.json({ success: true });
        }

        // No selector: remove every push token of this user (logout flow).
        db.prepare('DELETE FROM push_tokens WHERE user_id = ?').run(userId);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Follow ----
app.post('/api/users/:id/follow', requireAuth, (req, res) => {
    try {
        if (req.user.userId === req.params.id) return res.status(400).json({ error: 'Cannot follow yourself' });
        const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.userId, req.params.id);
        if (existing) return res.status(409).json({ error: 'Already following' });
        db.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?, ?, ?)').run(generateId(), req.user.userId, req.params.id);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Users: Unfollow ----
app.delete('/api/users/:id/follow', requireAuth, (req, res) => {
    try {
        const info = db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.userId, req.params.id);
        return res.json({ success: info.changes > 0 });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// Devices (X3DH)
// ============================================================================

// ---- Devices: List (own) ----
app.get('/api/devices', requireAuth, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT * FROM user_devices WHERE user_id = ? ORDER BY created_at DESC, id DESC
        `).all(req.user.userId);
        return res.json(rows.map(formatDevice));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Devices: Register ----
// Body: { deviceName?, identityKey, signedPreKey, preKeySignature, oneTimePreKeys: string[] }
// All key material is base64 (never hex).
app.post('/api/devices', requireAuth, (req, res) => {
    try {
        const { deviceName, identityKey, signedPreKey, preKeySignature, oneTimePreKeys } = req.body || {};

        if (!identityKey || typeof identityKey !== 'string') {
            return res.status(400).json({ error: 'identityKey is required (base64 X25519 public key)' });
        }
        if (!signedPreKey || typeof signedPreKey !== 'string') {
            return res.status(400).json({ error: 'signedPreKey is required (base64 X25519 public key)' });
        }
        if (!preKeySignature || typeof preKeySignature !== 'string') {
            return res.status(400).json({ error: 'preKeySignature is required (base64 XEdDSA signature)' });
        }
        if (!Array.isArray(oneTimePreKeys) || oneTimePreKeys.length < 1) {
            return res.status(400).json({ error: 'oneTimePreKeys array is required (at least 1 base64 X25519 public key)' });
        }
        if (oneTimePreKeys.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 one-time prekeys allowed' });
        }
        if (deviceName !== undefined && deviceName !== null && (typeof deviceName !== 'string' || deviceName.length > 64)) {
            return res.status(400).json({ error: 'Device name too long (max 64 chars)' });
        }

        // base64 format + decoded length check (the server never uses the key
        // material itself; it only relays public keys).
        //   identityKey / signedPreKey / oneTimePreKeys: 33 bytes (0x05 + 32)
        //   preKeySignature: 64 bytes (XEdDSA signature)
        // NOTE: preKeySignature is an XEdDSA signature, not ed25519. XEdDSA
        // maps the Edwards curve to Montgomery form, so it is NOT compatible
        // with ed25519 verification and must not be verified as such here.
        if (!isBase64OfLength(identityKey, [32, 33]) || !isBase64OfLength(signedPreKey, [32, 33])) {
            return res.status(400).json({ error: 'identityKey and signedPreKey must be base64 encoded 33-byte X25519 public keys' });
        }
        if (!isBase64OfLength(preKeySignature, [64])) {
            return res.status(400).json({ error: 'preKeySignature must be a base64 encoded 64-byte XEdDSA signature' });
        }
        for (const key of oneTimePreKeys) {
            if (!isBase64OfLength(key, [32, 33])) {
                return res.status(400).json({ error: 'All one-time prekeys must be base64 encoded 33-byte X25519 public keys' });
            }
        }

        // preKey ids are the array index (matches the client's local prekey ids)
        const preKeys = oneTimePreKeys.map((publicKey, index) => ({ id: index, publicKey }));

        const info = db.prepare(`
            INSERT INTO user_devices (user_id, device_name, identity_key, signed_pre_key, pre_key_signature, one_time_pre_keys)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            req.user.userId,
            deviceName ? String(deviceName).trim() : null,
            identityKey,
            signedPreKey,
            preKeySignature,
            serializePreKeys(preKeys)
        );

        const row = db.prepare('SELECT * FROM user_devices WHERE id = ?').get(info.lastInsertRowid);
        return res.status(201).json(formatDevice(row));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Devices: Delete (own only) ----
app.delete('/api/devices/:deviceId', requireAuth, (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const info = db.prepare('DELETE FROM user_devices WHERE id = ? AND user_id = ?')
            .run(deviceId, req.user.userId);

        if (info.changes === 0) {
            // Another user's device (or a non-existent one) is reported as 404.
            return res.status(404).json({ error: 'Device not found.' });
        }

        // Keep push tokens consistent with the deleted device.
        db.prepare('DELETE FROM push_tokens WHERE user_id = ? AND device_id = ?')
            .run(req.user.userId, String(deviceId));

        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Devices: List (another user, public keys only) ----
app.get('/api/devices/user/:userId', requireAuth, (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
        if (!target) return res.status(404).json({ error: 'User not found' });

        const rows = db.prepare(`
            SELECT * FROM user_devices WHERE user_id = ? ORDER BY created_at DESC, id DESC
        `).all(targetUserId);
        return res.json(rows.map(formatDevice));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ============================================================================
// Key Bundles (X3DH)
// ============================================================================

// ---- Keys: Bundle ----
// Query: ?deviceId=<optional>
// The first unused one-time prekey is consumed and returned together with
// its id (`preKeyId`). 404 when the target has no usable prekey left,
// because the client cannot establish a session without one.
app.get('/api/keys/bundle/:userId', requireAuth, (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const requestedDeviceId = req.query.deviceId;

        const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
        if (!target) return res.status(404).json({ error: 'Target user not found' });

        // Pick the requested device, or the most recent one.
        let row = null;
        if (requestedDeviceId !== undefined && requestedDeviceId !== null && requestedDeviceId !== '') {
            row = db.prepare('SELECT * FROM user_devices WHERE user_id = ? AND id = ?')
                .get(targetUserId, requestedDeviceId);
        }
        if (!row) {
            row = db.prepare(`
                SELECT * FROM user_devices WHERE user_id = ?
                ORDER BY created_at DESC, id DESC LIMIT 1
            `).get(targetUserId);
        }
        if (!row) {
            return res.status(404).json({ error: 'No prekeys available' });
        }

        const preKeys = parsePreKeys(row.one_time_pre_keys);
        if (preKeys.length === 0) {
            return res.status(404).json({ error: 'No prekeys available' });
        }

        // Consume the first prekey so that it is never handed out twice.
        const [consumed, ...remaining] = preKeys;
        db.prepare('UPDATE user_devices SET one_time_pre_keys = ? WHERE id = ?')
            .run(serializePreKeys(remaining), row.id);

        return res.json({
            userId: targetUserId,
            deviceId: String(row.id),
            bundle: {
                identityKey: row.identity_key,
                signedPreKey: row.signed_pre_key,
                preKeySignature: row.pre_key_signature,
                // Existing key name / format (array of base64 strings) is kept.
                oneTimePreKeys: [consumed.publicKey],
                // New: the id of the prekey that was just handed out.
                preKeyId: consumed.id,
            },
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Posts: Feed ----
app.get('/api/posts/feed', (req, res) => {
    try {
        const userId = extractUserId(req.headers.authorization);
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = parseInt(req.query.offset) || 0;

        let rows;
        if (userId) {
            rows = db.prepare(`
                SELECT p.id, p.content, p.signature, p.created_at,
                       u.id as author_id, u.username as author_username, u.display_name as author_display_name
                FROM kb_posts p JOIN users u ON u.id = p.author_id
                WHERE p.author_id = ? OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
                ORDER BY p.created_at DESC LIMIT ? OFFSET ?
            `).all(userId, userId, limit, offset);
        } else {
            rows = db.prepare(`
                SELECT p.id, p.content, p.signature, p.created_at,
                       u.id as author_id, u.username as author_username, u.display_name as author_display_name
                FROM kb_posts p JOIN users u ON u.id = p.author_id
                ORDER BY p.created_at DESC LIMIT ? OFFSET ?
            `).all(limit, offset);
        }
        return res.json(rows.map(formatPost));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Posts: Create ----
app.post('/api/posts', requireAuth, (req, res) => {
    try {
        const { content, signature } = req.body;
        if (!content || !signature) return res.status(400).json({ error: 'Content and signature required' });
        const trimmed = content.trim();
        if (trimmed.length === 0 || trimmed.length > 2000) return res.status(400).json({ error: 'Content must be 1-2000 characters' });

        const id = generateId();
        db.prepare('INSERT INTO kb_posts (id, author_id, content, signature) VALUES (?, ?, ?, ?)').run(id, req.user.userId, trimmed, signature);

        const post = db.prepare(`
            SELECT p.id, p.content, p.signature, p.created_at,
                   u.id as author_id, u.username as author_username, u.display_name as author_display_name
            FROM kb_posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?
        `).get(id);

        const formatted = formatPost(post);
        broadcast('post_created', formatted);
        return res.status(201).json(formatted);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Posts: Get by ID ----
app.get('/api/posts/:id', (req, res) => {
    try {
        const row = db.prepare(`
            SELECT p.id, p.content, p.signature, p.created_at,
                   u.id as author_id, u.username as author_username, u.display_name as author_display_name
            FROM kb_posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?
        `).get(req.params.id);
        if (!row) return res.status(404).json({ error: 'Post not found' });
        return res.json(formatPost(row));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- DMs: List ----
app.get('/api/dms', requireAuth, (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const unreadOnly = req.query.unread === 'true';

        let rows;
        if (unreadOnly) {
            rows = db.prepare(`
                SELECT d.id, d.content, d.signature, d.is_read, d.created_at,
                       s.id as sender_id, s.username as sender_username, s.display_name as sender_display_name,
                       r.id as recipient_id, r.username as recipient_username, r.display_name as recipient_display_name
                FROM dms d JOIN users s ON s.id = d.sender_id JOIN users r ON r.id = d.recipient_id
                WHERE d.recipient_id = ? AND d.is_read = 0
                ORDER BY d.created_at DESC LIMIT ? OFFSET ?
            `).all(req.user.userId, limit, offset);
        } else {
            rows = db.prepare(`
                SELECT d.id, d.content, d.signature, d.is_read, d.created_at,
                       s.id as sender_id, s.username as sender_username, s.display_name as sender_display_name,
                       r.id as recipient_id, r.username as recipient_username, r.display_name as recipient_display_name
                FROM dms d JOIN users s ON s.id = d.sender_id JOIN users r ON r.id = d.recipient_id
                WHERE d.recipient_id = ? OR d.sender_id = ?
                ORDER BY d.created_at DESC LIMIT ? OFFSET ?
            `).all(req.user.userId, req.user.userId, limit, offset);
        }
        return res.json(rows.map(formatDM));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- DMs: Unread Count ----
app.get('/api/dms/unread/count', requireAuth, (req, res) => {
    try {
        const count = db.prepare('SELECT COUNT(*) as c FROM dms WHERE recipient_id = ? AND is_read = 0').get(req.user.userId).c;
        return res.json({ count });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- DMs: Send ----
// Body: { content, signature, preKeyId? }
// `content` is the E2E ciphertext and is stored verbatim — the server never
// decrypts it.
app.post('/api/dms/:userId', requireAuth, (req, res) => {
    try {
        const { content, signature, preKeyId } = req.body || {};
        if (!content || !signature) return res.status(400).json({ error: 'Content and signature required' });
        if (content.trim().length > 5000) return res.status(400).json({ error: 'Content exceeds 5000 characters' });
        if (req.user.userId === req.params.userId) return res.status(400).json({ error: 'Cannot DM yourself' });

        const recipient = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
        if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

        const id = generateId();
        db.prepare('INSERT INTO dms (id, sender_id, recipient_id, content, signature) VALUES (?, ?, ?, ?, ?)').run(id, req.user.userId, req.params.userId, content.trim(), signature);

        const row = db.prepare('SELECT * FROM dms WHERE id = ?').get(id);
        const createdAt = toIso(row.created_at);

        // If the client told us which one-time prekey it used, drop it.
        if (preKeyId !== undefined && preKeyId !== null) {
            consumePreKey(req.params.userId, Number(preKeyId));
        }

        const dmEvent = {
            id,
            from: { id: req.user.userId, username: req.user.username },
            to: { id: recipient.id, username: recipient.username },
            content: content.trim(),
            signature,
            timestamp: createdAt,
        };
        broadcast('dm_received', dmEvent, req.params.userId);

        // Delivery confirmation for the sender's other devices.
        broadcast('dm_sent', {
            id,
            to: { id: recipient.id, username: recipient.username },
            content: content.trim(),
            signature,
            timestamp: createdAt,
        }, req.user.userId);

        return res.status(201).json(formatDM(row));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- DMs: Mark Read ----
app.put('/api/dms/:id/read', requireAuth, (req, res) => {
    try {
        const info = db.prepare('UPDATE dms SET is_read = 1 WHERE id = ? AND recipient_id = ?').run(req.params.id, req.user.userId);
        const success = info.changes > 0;

        // Notify the sender that their message was read.
        if (success) {
            const row = db.prepare('SELECT sender_id FROM dms WHERE id = ?').get(req.params.id);
            if (row) {
                broadcast('dm_read', {
                    id: req.params.id,
                    by: { id: req.user.userId, username: req.user.username },
                }, row.sender_id);
            }
        }

        return res.json({ success });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- Config (Web UI reads runtime config) ----
app.get('/api/config', (req, res) => {
    res.json({
        version: '5.0.0',
        mode: 'serverless-p2p',
        serverUrl: null,            // null = same-origin (serverless default)
        apiBase: '',                // relative (same-origin)
        p2p: { ready: false, peers: 0 },
        timestamp: new Date().toISOString(),
    });
});

// ---- Static Files (Web UI) ----
const webPath = join(__dirname, '..', '..', 'web');
if (existsSync(webPath)) {
    app.use(express.static(webPath, { index: 'index.html', extensions: ['html'], maxAge: '1h' }));
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(join(webPath, 'index.html'));
    });
}

// ============================================================================
// HTTP Server + WebSocket
// ============================================================================
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 * 100 });

const userSockets = new Map();
const socketUsers = new Map();

function broadcast(event, payload, targetUserId = null) {
    const message = JSON.stringify({ type: event, payload });
    if (targetUserId) {
        const sockets = userSockets.get(targetUserId);
        if (sockets) sockets.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(message); });
    } else {
        wss.clients.forEach(ws => { if (ws.readyState === ws.OPEN) ws.send(message); });
    }
}

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) { ws.close(4001, 'Authentication required'); return; }

    let decoded;
    try { decoded = verifyToken(token); } catch { ws.close(4001, 'Invalid token'); return; }

    const { userId, username } = decoded;
    socketUsers.set(ws, { userId, username });
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId).add(ws);

    logger.info({ userId, username }, 'WebSocket connected');
    ws.send(JSON.stringify({ type: 'connected', payload: { userId, username } }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', payload: { timestamp: new Date().toISOString() } }));
                return;
            }
            // Typing indicator → forward to the conversation partner.
            if (msg.type === 'typing_start' || msg.type === 'typing_stop') {
                const conversationId = msg.payload && msg.payload.conversationId;
                if (typeof conversationId === 'string' && conversationId && conversationId !== userId) {
                    broadcast(msg.type, {
                        conversationId,
                        from: { id: userId, username },
                    }, conversationId);
                }
            }
        } catch { /* ignore */ }
    });

    ws.on('close', () => {
        const user = socketUsers.get(ws);
        if (user) {
            const sockets = userSockets.get(user.userId);
            if (sockets) { sockets.delete(ws); if (sockets.size === 0) userSockets.delete(user.userId); }
            socketUsers.delete(ws);
        }
    });

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat
setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// ============================================================================
// Start
// ============================================================================
const PORT = parseInt(process.env.PORT) || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
  ╔══════════════════════════════════════════════╗
  ║        🏄 koshi standalone server            ║
  ╠══════════════════════════════════════════════╣
  ║  REST API : http://localhost:${PORT}/api        ║
  ║  WebSocket: ws://localhost:${PORT}/ws           ║
  ║  Web UI   : http://localhost:${PORT}            ║
  ║  Health   : http://localhost:${PORT}/api/health  ║
  ╠══════════════════════════════════════════════╣
  ║  Database : SQLite (auto-created)            ║
  ║  No external services required!              ║
  ╚══════════════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on('SIGTERM', () => { wss.close(); server.close(); db.close(); process.exit(0); });
process.on('SIGINT', () => { wss.close(); server.close(); db.close(); process.exit(0); });
