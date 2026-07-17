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
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
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
const JWT_SECRET = process.env.JWT_SECRET || randomUUID();

function signToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
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
    if (sig !== expected) throw new Error('Invalid token signature');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload;
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

const DB_PATH = join(LOCAL_DIR, 'server.db');
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
        createdAt: row.created_at,
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
        createdAt: row.created_at,
    };
}

function generateId() {
    return randomUUID();
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
    res.json({ status: 'ok', service: 'koshi-standalone', version: '2.0.2', mode: 'standalone', timestamp: new Date().toISOString() });
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
        const token = signToken({ userId: id, username: uname });
        return res.status(201).json({ userId: id, token });
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

        const token = signToken({ userId: user.id, username: user.username });
        return res.json({ token, userId: user.id });
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

// ---- Users: Profile ----
app.get('/api/users/:username', (req, res) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username.trim().toLowerCase());
        if (!user) return res.status(404).json({ error: 'User not found' });
        const followersCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(user.id).c;
        const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(user.id).c;
        return res.json({
            id: user.id, username: user.username, displayName: user.display_name,
            bio: user.bio, avatarUrl: user.avatar_url, followersCount, followingCount, createdAt: user.created_at,
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
app.post('/api/dms/:userId', requireAuth, (req, res) => {
    try {
        const { content, signature } = req.body;
        if (!content || !signature) return res.status(400).json({ error: 'Content and signature required' });
        if (content.trim().length > 5000) return res.status(400).json({ error: 'Content exceeds 5000 characters' });
        if (req.user.userId === req.params.userId) return res.status(400).json({ error: 'Cannot DM yourself' });

        const recipient = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
        if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

        const id = generateId();
        db.prepare('INSERT INTO dms (id, sender_id, recipient_id, content, signature) VALUES (?, ?, ?, ?, ?)').run(id, req.user.userId, req.params.userId, content.trim(), signature);

        const dmEvent = { id, from: { id: req.user.userId, username: req.user.username }, content: content.trim(), signature };
        broadcast('dm_received', dmEvent, req.params.userId);
        return res.status(201).json({ id });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ---- DMs: Mark Read ----
app.put('/api/dms/:id/read', requireAuth, (req, res) => {
    try {
        const info = db.prepare('UPDATE dms SET is_read = 1 WHERE id = ? AND recipient_id = ?').run(req.params.id, req.user.userId);
        return res.json({ success: info.changes > 0 });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
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
            if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', payload: { timestamp: new Date().toISOString() } }));
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
