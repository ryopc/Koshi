// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Local Express Server (Standalone Mode)
// License: MIT
// ============================================================================
// A lightweight Express server that runs locally, wrapping the local SQLite
// API. This allows the web UI to work in offline/standalone mode.
//
// Usage:
//   import { startLocalServer } from '../src/local/server.js';
//   await startLocalServer({ port: 3000 });
// ============================================================================

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { localAPI } from './api.js';
import { logger } from '../logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Start a local Express server that wraps the local API.
 *
 * @param {object} [options]
 * @param {number} [options.port=0] - Port to listen on (0 = random)
 * @returns {Promise<{ app, server, port }>}
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

    // ---- Posts Routes ----
    app.get('/api/posts/feed', async (req, res) => {
        try {
            const userId = req.headers.authorization
                ? extractUserId(req.headers.authorization)
                : null;
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

    // ---- Health Check ----
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'ok',
            service: 'koshi-local',
            version: '2.0.2',
            mode: 'local',
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

    // ---- Start server ----
    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            const actualPort = server.address().port;
            logger.info({ port: actualPort }, 'Local server started');
            resolve({ app, server, port: actualPort });
        });
        server.on('error', reject);
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
    // In local mode, we trust the token since it's generated locally
    try {
        // Dynamic import for ESM compatibility (inside async route handler)
        // use base64 decode of JWT payload
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
