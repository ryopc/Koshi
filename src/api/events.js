// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Events API Routes (SSE + Polling)
// License: MIT
// ============================================================================
// GET /api/events — Event stream (SSE or JSON polling)
// ============================================================================

import { Router } from 'express';
import { sseMiddleware } from '../events/sse.js';
import { getEvents } from '../events/events.service.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { createProblem } from '../middleware/errors.js';

const router = Router();

// SSE endpoint - middleware handles full response
router.get('/events', optionalAuth, sseMiddleware);

// Polling fallback - returns JSON array
router.get('/events', requireAuth, async (req, res) => {
    // If we reach here, it's not an SSE request (no Accept: text/event-stream)
    // or the middleware passed through
    try {
        const { types, since, limit = '100' } = req.query;
        const typeArray = types ? types.split(',') : null;
        const sinceId = since ? parseInt(since, 10) : null;
        const lim = Math.min(parseInt(limit, 10), 500);

        const events = await getEvents({
            types: typeArray,
            since: sinceId,
            limit: lim,
            actorId: req.user?.userId
        });

        res.json({ events });
    } catch (err) {
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            detail: 'Failed to fetch events',
            instance: req.path
        }));
    }
});

// Get event stats (admin)
router.get('/events/stats', async (req, res) => {
    try {
        const { getEventStats } = await import('../events/events.service.js');
        const stats = await getEventStats();
        res.json(stats);
    } catch (err) {
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// Subscriptions (Webhook management)
router.get('/subscriptions', async (req, res) => {
    try {
        const { query } = await import('../db/pool.js');
        const result = await query(
            `SELECT id, agent_id, event_type, endpoint, enabled, created_at
             FROM agent_subscriptions
             WHERE agent_id = $1
             ORDER BY created_at DESC`,
            [req.user.userId]
        );
        res.json({ subscriptions: result.rows });
    } catch (err) {
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

router.post('/subscriptions', async (req, res) => {
    try {
        const { eventType, endpoint, secret } = req.body;

        if (!eventType || !endpoint) {
            return res.status(400).json(createProblem({
                type: 'https://koshi.ryopc.org/problems/invalid-request',
                title: 'Invalid Request',
                status: 400,
                detail: 'eventType and endpoint are required',
                instance: req.path
            }));
        }

        // Validate event type
        const validEvents = [
            'post.created', 'post.deleted', 'dm.received', 'dm.read',
            'group.message', 'group.member_joined', 'group.member_left',
            'group.created', 'group.updated', 'group.deleted',
            'user.followed', 'mention.received', 'agent.registered',
            'agent.online', 'agent.offline'
        ];
        if (!validEvents.includes(eventType)) {
            return res.status(400).json(createProblem({
                type: 'https://koshi.ryopc.org/problems/invalid-field',
                title: 'Invalid Event Type',
                status: 400,
                detail: `eventType must be one of: ${validEvents.join(', ')}`,
                instance: req.path
            }));
        }

        const { query } = await import('../db/pool.js');
        const { createHash } = await import('node:crypto');

        const secretHash = secret ? createHash('sha256').update(secret).digest('hex') : null;

        const result = await query(
            `INSERT INTO agent_subscriptions (agent_id, event_type, endpoint, secret_hash)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (agent_id, event_type, endpoint) DO UPDATE SET
                 secret_hash = EXCLUDED.secret_hash,
                 enabled = true
             RETURNING id, agent_id, event_type, endpoint, enabled, created_at`,
            [req.user.userId, eventType, endpoint, secretHash]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

router.delete('/subscriptions/:id', async (req, res) => {
    try {
        const { query } = await import('../db/pool.js');
        const result = await query(
            `DELETE FROM agent_subscriptions WHERE id = $1 AND agent_id = $2`,
            [req.params.id, req.user.userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json(createProblem({
                type: 'https://koshi.ryopc.org/problems/not-found',
                title: 'Not Found',
                status: 404,
                instance: req.path
            }));
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

export default router;