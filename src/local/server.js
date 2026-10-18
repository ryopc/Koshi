// ============================================================================
// koshi – Terminal-Native Decentralized SNS v3.1.6
// Local Server (Standalone — REST + WebSocket + Static Web UI)
// License: MIT
// ============================================================================
// A lightweight server that runs on YOUR OWN machine (kb serve), wrapping the
// local SQLite API + P2P mesh. This replaces the central koshi server: the
// web UI talks to your node, and the P2P mesh handles everything else.
//
// Usage:
//   import { startLocalServer } from '../src/local/server.js';
//   await startLocalServer({ port: 3000 });
// ============================================================================

import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { localAPI } from './api.js';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// WebSocket state
// ============================================================================
const _clients = new Map(); // userId -> Set<ws>

function wsSend(ws, type, payload) {
    if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

function broadcast(type, payload, userId = null) {
    for (const [targetUserId, sockets] of _clients) {
        if (userId && targetUserId !== userId) continue;
        for (const ws of sockets) wsSend(ws, type, payload);
    }
}

function extractUserIdFromToken(token) {
    if (!token) return null;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        return payload.userId || null;
    } catch {
        return null;
    }
}

// ============================================================================
// WebSocket handlers (local equivalent of src/ws/handlers.js)
// ============================================================================

async function handleWSMessage(ws, message, userId) {
    const { type, payload } = message || {};
    if (!type) {
        wsSend(ws, 'error', { message: 'Message must include a "type" field.' });
        return;
    }

    try {
        switch (type) {
            case 'ping':
                wsSend(ws, 'pong', { timestamp: new Date().toISOString() });
                break;

            case 'post:create':
                await handleWSPostCreate(ws, payload, userId);
                break;

            case 'dm:send':
                await handleWSDmSend(ws, payload, userId);
                break;

            case 'p2p:status': {
                const p2p = await import('../p2p/index.js').catch(() => null);
                wsSend(ws, 'p2p:status', p2p ? { available: true, ...p2p.getP2PStatus() } : { available: false });
                break;
            }

            case 'p2p:sync': {
                const p2p = await import('../p2p/index.js').catch(() => null);
                if (!p2p) {
                    wsSend(ws, 'p2p:sync', { success: false, message: 'P2P not available' });
                    break;
                }
                if (!p2p.isReady()) await p2p.initP2PNode();
                wsSend(ws, 'p2p:sync', { success: true, status: p2p.getP2PStatus() });
                break;
            }

            default:
                wsSend(ws, 'error', { message: `Unknown message type: "${type}".` });
        }
    } catch (err) {
        logger.error({ err, type, userId }, 'Local WS handler error');
        wsSend(ws, 'error', { message: `Error processing message: ${err.message}` });
    }
}

async function handleWSPostCreate(ws, payload, userId) {
    const { content, signature } = payload || {};
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        wsSend(ws, 'error', { message: 'Content is required and cannot be empty.' });
        return;
    }
    if (content.trim().length > 2000) {
        wsSend(ws, 'error', { message: 'Content exceeds 2000 characters.' });
        return;
    }
    if (!signature || typeof signature !== 'string') {
        wsSend(ws, 'error', { message: 'Signature is required.' });
        return;
    }

    const post = await localAPI.createPost(userId, content, signature);
    const event = {
        id: post.id,
        author: post.author,
        content: post.content,
        signature: post.signature,
        timestamp: post.createdAt,
    };

    wsSend(ws, 'post:created', event);
    broadcast('post_created', event);
}

async function handleWSDmSend(ws, payload, userId) {
    const { recipientId, content, signature } = payload || {};
    if (!recipientId || typeof recipientId !== 'string') {
        wsSend(ws, 'error', { message: 'recipientId is required.' });
        return;
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        wsSend(ws, 'error', { message: 'Content is required and cannot be empty.' });
        return;
    }
    if (content.trim().length > 5000) {
        wsSend(ws, 'error', { message: 'Content exceeds 5000 characters.' });
        return;
    }
    if (!signature) {
        wsSend(ws, 'error', { message: 'Signature is required.' });
        return;
    }

    const dm = await localAPI.sendDM(userId, recipientId, content, signature);
    const event = {
        id: dm.id,
        from: dm.from,
        content: dm.content,
        signature: dm.signature,
        timestamp: dm.createdAt,
    };

    wsSend(ws, 'dm:sent', event);
    broadcast('dm_received', event, recipientId);
}

// ============================================================================
// Server startup
// ============================================================================

/**
 * Start a local server that wraps the local API + P2P mesh.
 *
 * @param {object} [options]
 * @param {number} [options.port=0] - Port to listen on (0 = random)
 * @returns {Promise<{ app, server, wss, port }>}
 */
export async function startLocalServer(options = {}) {
    const port = options.port || 0;

    // Ensure local API is initialized
    await localAPI.init();

    const app = express();
    app.use(express.json());

    // ---- Auth Routes ----
    app.post('/api/auth/register', async (req, res) => {
        try {
            const { username, publicKey } = req.body;
            const result = await localAPI.register(username, publicKey);
            return res.status(201).json(result);
        } catch (err) {
            const status = err.message.includes('Conflict') ? 409
                : err.message.includes('format') ? 400 : 500;
            return res.status(status).json({ error: err.message });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        try {
            const { username, signature } = req.body;
            const result = await localAPI.login(username, signature);
            return res.json(result);
        } catch (err) {
            const status = err.message.includes('not found') ? 404
                : err.message.includes('Invalid') ? 401 : 500;
            return res.status(status).json({ error: err.message });
        }
    });

    // ---- Users Routes ----
    app.get('/api/users/search/:query', async (req, res) => {
        try {
            const results = await localAPI.searchUsers(req.params.query);
            return res.json(results);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
    });

    app.get('/api/users/:username', async (req, res) => {
        try {
            const profile = await localAPI.getUserProfile(req.params.username);
            return res.json(profile);
        } catch (err) {
            return res.status(404).json({ error: err.message });
        }
    });

    app.put('/api/users/me', async (req, res) => {
        try {
            const userId = extractUserId(req.headers.authorization);
            const { displayName, bio, avatarUrl } = req.body || {};
            const profile = await localAPI.updateProfile(userId, { displayName, bio, avatarUrl });
            return res.json(profile);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
    });

    app.post('/api/users/:id/follow', async (req, res) => {
        try {
            const followerId = extractUserId(req.headers.authorization);
            const result = await localAPI.followUser(followerId, req.params.id);
            return res.json(result);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
    });

    app.delete('/api/users/:id/follow', async (req, res) => {
        try {
            const followerId = extractUserId(req.headers.authorization);
            const result = await localAPI.unfollowUser(followerId, req.params.id);
            return res.json(result);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
    });

    app.get('/api/users/:id/followers', async (req, res) => {
        try {
            const users = await import('./db.js');
            const rows = await users.users.getFollowers(req.params.id);
            return res.json(rows.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name })));
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/users/:id/following', async (req, res) => {
        try {
            const users = await import('./db.js');
            const rows = await users.users.getFollowing(req.params.id);
            return res.json(rows.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name })));
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    // ---- Users: Self-delete ----
    app.delete('/api/users/me', async (req, res) => {
        try {
            const userId = extractUserId(req.headers.authorization);
            await localAPI.deleteUser(userId);
            return res.json({ success: true, message: 'Account permanently deleted.' });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    // ---- Posts Routes ----
    app.get('/api/posts/feed', async (req, res) => {
        try {
            const userId = req.headers.authorization ? extractUserId(req.headers.authorization) : null;
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const offset = parseInt(req.query.offset) || 0;
            const feed = await localAPI.getFeed(userId, limit, offset);
            return res.json(feed);
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/posts', async (req, res) => {
        try {
            const userId = extractUserId(req.headers.authorization);
            const { content, signature } = req.body;
            const post = await localAPI.createPost(userId, content, signature);
            return res.status(201).json(post);
        } catch (err) {
            const status = err.message.includes('required') ? 400 : 500;
            return res.status(status).json({ error: err.message });
        }
    });

    app.get('/api/posts/:id', async (req, res) => {
        try {
            const post = await localAPI.getPost(req.params.id);
            return res.json(post);
        } catch (err) {
            return res.status(404).json({ error: err.message });
        }
    });

    // ---- DMs Routes ----
    app.get('/api/dms', async (req, res) => {
        try {
            const userId = extractUserId(req.headers.authorization);
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);
            const offset = parseInt(req.query.offset) || 0;
            const unreadOnly = req.query.unread === 'true';
            const dms = await localAPI.getDMs(userId, limit, offset, unreadOnly);
            return res.json(dms);
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/dms/:userId', async (req, res) => {
        try {
            const senderId = extractUserId(req.headers.authorization);
            const { content, signature } = req.body;
            const dm = await localAPI.sendDM(senderId, req.params.userId, content, signature);
            return res.status(201).json(dm);
        } catch (err) {
            const status = err.message.includes('required') ? 400 : 500;
            return res.status(status).json({ error: err.message });
        }
    });

    app.put('/api/dms/:id/read', async (req, res) => {
        try {
            const userId = extractUserId(req.headers.authorization);
            const result = await localAPI.markDMAsRead(req.params.id, userId);
            return res.json(result);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }
    });

    app.get('/api/dms/unread/count', async (req, res) => {
        try {
            const userId = extractUserId(req.headers.authorization);
            const result = await localAPI.getUnreadDMCount(userId);
            return res.json(result);
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    // ---- Admin Routes (local-only, first registered user is admin) ----
    app.get('/api/admin/users', async (req, res) => {
        try {
            const userId = extractUserId(req.headers.authorization);
            const db = await import('./db.js');
            const me = await db.users.findById(userId);
            if (!me?.is_admin) return res.status(403).json({ error: 'Admin privileges required.' });
            return res.json(await localAPI.adminListUsers());
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    // ---- P2P Routes ----
    app.get('/api/p2p/status', async (req, res) => {
        try {
            const p2p = await import('../p2p/index.js').catch(() => null);
            return res.json(p2p ? { available: true, ...p2p.getP2PStatus() } : { available: false });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    app.get('/api/p2p/peers', async (req, res) => {
        try {
            const p2p = await import('../p2p/index.js').catch(() => null);
            return res.json(p2p ? p2p.getKnownPeers() : []);
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

    // ---- Health Check ----
    app.get('/api/health', async (req, res) => {
        const p2p = await import('../p2p/index.js').catch(() => null);
        res.json({
            status: 'ok',
            service: 'koshi-local',
            version: '3.1.6',
            mode: 'serverless-p2p',
            p2p: p2p ? p2p.getP2PStatus() : { ready: false },
            timestamp: new Date().toISOString(),
        });
    });

    // ---- Config (Web UI reads runtime config) ----
    app.get('/api/config', async (req, res) => {
        const p2p = await import('../p2p/index.js').catch(() => null);
        res.json({
            version: '3.1.6',
            mode: 'serverless-p2p',
            serverUrl: null, // null = same-origin (serverless default)
            apiBase: '',     // relative (same-origin)
            p2p: p2p ? p2p.getP2PStatus() : { ready: false, peers: 0 },
            timestamp: new Date().toISOString(),
        });
    });

    // ---- Serve static web files ----
    const webPath = join(__dirname, '..', '..', 'web');
    app.use(express.static(webPath, {
        index: 'index.html',
        extensions: ['html'],
        maxAge: '1h',
    }));

    // SPA fallback
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(join(webPath, 'index.html'));
    });

    // ---- Create HTTP server + WebSocket ----
    const server = createServer(app);
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, 'http://localhost');
        const userId = extractUserIdFromToken(url.searchParams.get('token'));

        if (!userId) {
            ws.close(4001, 'Authentication required');
            return;
        }

        if (!_clients.has(userId)) _clients.set(userId, new Set());
        _clients.get(userId).add(ws);

        wsSend(ws, 'connected', { userId });

        ws.on('message', (data) => {
            try {
                handleWSMessage(ws, JSON.parse(data.toString()), userId);
            } catch { /* ignore parse errors */ }
        });

        ws.on('close', () => {
            const sockets = _clients.get(userId);
            if (sockets) {
                sockets.delete(ws);
                if (sockets.size === 0) _clients.delete(userId);
            }
        });

        ws.on('error', () => { /* ignore */ });
    });

    // Push P2P-arrived posts/DMs to connected web clients in realtime
    try {
        const p2p = await import('../p2p/index.js').catch(() => null);
        let lastPostIds = new Set();
        let lastDmIds = new Set();
        if (p2p) {
            p2p.subscribe(async () => {
                try {
                    const posts = await p2p.getPosts();
                    const dms = await p2p.getDMs();
                    for (const post of posts.slice(0, 20)) {
                        if (!lastPostIds.has(post.id)) {
                            lastPostIds.add(post.id);
                            broadcast('post_created', {
                                id: post.id,
                                author: { username: post.username, displayName: post.displayName },
                                content: post.content,
                                timestamp: post.createdAt,
                            });
                        }
                    }
                    for (const dm of dms.slice(0, 20)) {
                        if (!lastDmIds.has(dm.id)) {
                            lastDmIds.add(dm.id);
                            broadcast('dm_received', {
                                id: dm.id,
                                from: { username: dm.fromUsername },
                                content: dm.content,
                                timestamp: dm.createdAt,
                            });
                        }
                    }
                } catch { /* ignore */ }
            });
        }
    } catch { /* p2p bridge for web realtime is optional */ }

    // ---- Start server ----
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const actualPort = server.address().port;
            logger.info({ port: actualPort }, 'Local server started (serverless P2P)');
            resolve({ app, server, wss, port: actualPort });
        });
    });
}

/**
 * Extract user ID from a Bearer token.
 * For the local server, we decode the token (not verify, since we trust local).
 */
function extractUserId(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Authentication required.');
    }
    try {
        const parts = authHeader.slice(7).split('.');
        if (parts.length !== 3) throw new Error('Invalid token format.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (!payload || !payload.userId) throw new Error('Invalid token payload.');
        return payload.userId;
    } catch (err) {
        throw new Error('Invalid token: ' + err.message);
    }
}

export default { startLocalServer };
