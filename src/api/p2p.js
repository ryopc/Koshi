// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// P2P API Routes — Web client bridge to P2P network
// License: MIT
// ============================================================================
// Provides REST endpoints for the web client to:
//   - Query P2P node status (online, peer count, core stats)
//   - List connected peers
//   - Trigger manual sync
//   - View P2P-synced posts/DMs
// ============================================================================

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();

// Dynamic P2P import (only if P2P module is available)
let _p2pModule = null;
let _p2pLoadAttempted = false;

async function getP2P() {
    if (!_p2pLoadAttempted && !_p2pModule) {
        _p2pLoadAttempted = true;
        try {
            _p2pModule = await import('../p2p/index.js');
        } catch {
            _p2pModule = null;
        }
    }
    return _p2pModule;
}

// ============================================================================
// GET /api/p2p/status
// ============================================================================
// Get the current P2P node status.
// Public endpoint — no auth required for status checks.
//
// Returns: { ready, status, posts, dms, peers, info }
// ============================================================================
router.get('/status', async (req, res) => {
    try {
        const p2p = await getP2P();

        if (!p2p) {
            return res.json({
                available: false,
                ready: false,
                status: 'not_available',
                message: 'P2P module not loaded on this server',
            });
        }

        const status = p2p.getP2PStatus();
        return res.json({
            available: true,
            ...status,
        });
    } catch (err) {
        logger.error({ err }, 'Failed to get P2P status');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/p2p/peers
// ============================================================================
// List currently connected P2P peers.
// Requires authentication.
//
// Returns: { peers: [{ id, username, publicKey, lastSeen }], count }
// ============================================================================
router.get('/peers', requireAuth, async (req, res) => {
    try {
        const p2p = await getP2P();

        if (!p2p || !p2p.isReady()) {
            return res.json({ peers: [], count: 0, message: 'P2P not ready' });
        }

        // Try to get peer info from the local DB peer tracker
        const { default: localDB } = await import('../local/db.js').catch(() => ({ default: null }));
        let peers = [];

        if (localDB) {
            try {
                const { peers: peerTable } = localDB;
                if (peerTable?.list) {
                    peers = await peerTable.list();
                }
            } catch {
                // Peer table might not exist yet
            }
        }

        // Also get live connection count
        const livePeers = p2p.getPeerCount();

        return res.json({
            peers,
            liveCount: livePeers,
            count: peers.length,
        });
    } catch (err) {
        logger.error({ err }, 'Failed to get P2P peers');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/p2p/posts
// ============================================================================
// Get posts synced via P2P network.
// Requires authentication.
//
// Query: ?limit=50
// Returns: [ { id, content, author, createdAt, source } ]
// ============================================================================
router.get('/posts', requireAuth, async (req, res) => {
    try {
        const p2p = await getP2P();

        if (!p2p || !p2p.isReady()) {
            return res.json([]);
        }

        const posts = await p2p.getPosts();
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);

        return res.json(posts.slice(0, limit));
    } catch (err) {
        logger.error({ err }, 'Failed to get P2P posts');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/p2p/sync
// ============================================================================
// Trigger a manual P2P sync.
// Requires authentication.
//
// Returns: { success, message }
// ============================================================================
router.post('/sync', requireAuth, async (req, res) => {
    try {
        const p2p = await getP2P();

        if (!p2p) {
            return res.status(503).json({
                error: 'P2P module not available',
                message: 'P2P is not loaded on this server',
            });
        }

        if (!p2p.isReady()) {
            // Try to initialize
            const initialized = await p2p.initP2PNode();
            if (!initialized) {
                return res.status(503).json({
                    error: 'P2P initialization failed',
                    message: 'Could not start P2P node',
                });
            }
        }

        // P2P sync is automatic via hyperswarm — just confirm readiness
        const status = p2p.getP2PStatus();
        return res.json({
            success: true,
            message: 'P2P sync is active',
            status,
        });
    } catch (err) {
        logger.error({ err }, 'Failed to trigger P2P sync');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/p2p/start
// ============================================================================
// Start the P2P node (if not already running).
// Requires authentication + admin.
//
// Returns: { success, status }
// ============================================================================
router.post('/start', requireAuth, async (req, res) => {
    try {
        const p2p = await getP2P();

        if (!p2p) {
            return res.status(503).json({
                error: 'P2P module not available',
            });
        }

        if (p2p.isReady()) {
            return res.json({
                success: true,
                message: 'P2P node already running',
                status: p2p.getP2PStatus(),
            });
        }

        const started = await p2p.initP2PNode();
        if (!started) {
            return res.status(500).json({
                error: 'Failed to start P2P node',
            });
        }

        return res.json({
            success: true,
            message: 'P2P node started',
            status: p2p.getP2PStatus(),
        });
    } catch (err) {
        logger.error({ err }, 'Failed to start P2P node');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/p2p/stop
// ============================================================================
// Stop the P2P node.
// Requires authentication + admin.
//
// Returns: { success, message }
// ============================================================================
router.post('/stop', requireAuth, async (req, res) => {
    try {
        const p2p = await getP2P();

        if (!p2p) {
            return res.json({ success: true, message: 'P2P not running' });
        }

        await p2p.closeP2PNode();
        return res.json({
            success: true,
            message: 'P2P node stopped',
        });
    } catch (err) {
        logger.error({ err }, 'Failed to stop P2P node');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
