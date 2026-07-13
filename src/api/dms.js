// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Direct Messages API Routes
// License: MIT
// ============================================================================
// Handles sending, receiving, and managing direct messages.
// All DMs are signed with the sender's ed25519 key for authenticity.
// ============================================================================

import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { getBroadcast } from '../ws/index.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// GET /api/dms
// ============================================================================
// Fetch the authenticated user's DM inbox.
//
// Headers: Authorization: Bearer {token}
// Query: ?limit=50&offset=0&unread=false
// Returns: [ { id, from, to, content, signature, isRead, createdAt } ]
// ============================================================================
router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const unreadOnly = req.query.unread === 'true';

        let result;

        if (unreadOnly) {
            result = await query(
                `SELECT
                    d.id,
                    d.content,
                    d.signature,
                    d.is_read,
                    d.created_at,
                    sender.id AS sender_id,
                    sender.username AS sender_username,
                    sender.display_name AS sender_display_name,
                    recipient.id AS recipient_id,
                    recipient.username AS recipient_username,
                    recipient.display_name AS recipient_display_name
                FROM dms d
                JOIN users sender ON sender.id = d.sender_id
                JOIN users recipient ON recipient.id = d.recipient_id
                WHERE d.recipient_id = $1 AND d.is_read = FALSE
                ORDER BY d.created_at DESC
                LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );
        } else {
            result = await query(
                `SELECT
                    d.id,
                    d.content,
                    d.signature,
                    d.is_read,
                    d.created_at,
                    sender.id AS sender_id,
                    sender.username AS sender_username,
                    sender.display_name AS sender_display_name,
                    recipient.id AS recipient_id,
                    recipient.username AS recipient_username,
                    recipient.display_name AS recipient_display_name
                FROM dms d
                JOIN users sender ON sender.id = d.sender_id
                JOIN users recipient ON recipient.id = d.recipient_id
                WHERE d.recipient_id = $1 OR d.sender_id = $1
                ORDER BY d.created_at DESC
                LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );
        }

        return res.json(
            result.rows.map((row) => ({
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
                isRead: row.is_read,
                createdAt: row.created_at,
            }))
        );
    } catch (err) {
        logger.error({ err }, 'Failed to fetch DMs');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/dms/:userId
// ============================================================================
// Send a direct message to a user.
//
// Headers: Authorization: Bearer {token}
// Body: { content: string, signature: string }
// Returns: { id, from, to, content, signature, createdAt }
// ============================================================================
router.post('/:userId', requireAuth, async (req, res) => {
    try {
        const senderId = req.user.userId;
        const recipientId = req.params.userId;
        const { content, signature } = req.body;

        // -- Input validation --
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'Content is required and must be a string.' });
        }

        const trimmedContent = content.trim();

        if (trimmedContent.length === 0) {
            return res.status(400).json({ error: 'Content cannot be empty.' });
        }

        if (trimmedContent.length > 5000) {
            return res.status(400).json({ error: 'Content exceeds maximum length of 5000 characters.' });
        }

        if (!signature || typeof signature !== 'string') {
            return res.status(400).json({ error: 'Signature is required and must be a string.' });
        }

        if (!/^[0-9a-f]{128}$/i.test(signature)) {
            return res.status(400).json({
                error: 'Invalid signature format.',
                message: 'Signature must be a 128-character hex string (64 bytes).',
            });
        }

        if (senderId === recipientId) {
            return res.status(400).json({ error: 'Cannot send a DM to yourself.' });
        }

        // Verify recipient exists
        const recipientCheck = await query('SELECT id, username FROM users WHERE id = $1', [recipientId]);
        if (recipientCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Recipient user not found.' });
        }

        const recipient = recipientCheck.rows[0];

        // -- Insert DM --
        const result = await query(
            `INSERT INTO dms (sender_id, recipient_id, content, signature)
             VALUES ($1, $2, $3, $4)
             RETURNING id, content, signature, is_read, created_at`,
            [senderId, recipientId, trimmedContent, signature]
        );

        const dm = result.rows[0];

        // Fetch sender info
        const senderResult = await query(
            'SELECT id, username, display_name FROM users WHERE id = $1',
            [senderId]
        );
        const sender = senderResult.rows[0];

        const dmResponse = {
            id: dm.id,
            from: {
                id: sender.id,
                username: sender.username,
                displayName: sender.display_name,
            },
            to: {
                id: recipient.id,
                username: recipient.username,
                displayName: null,
            },
            content: dm.content,
            signature: dm.signature,
            isRead: dm.is_read,
            createdAt: dm.created_at,
        };

        // Broadcast DM via WebSocket to recipient
        try {
            const broadcast = getBroadcast();
            if (broadcast) {
                broadcast('dm_received', {
                    from: { id: sender.id, username: sender.username },
                    content: dm.content,
                    signature: dm.signature,
                    timestamp: dm.created_at,
                }, recipientId);  // Targeted broadcast to recipient only
            }
        } catch (wsErr) {
            logger.warn({ err: wsErr }, 'Failed to broadcast DM via WebSocket');
        }

        logger.info({ dmId: dm.id, senderId, recipientId }, 'DM sent');

        return res.status(201).json(dmResponse);
    } catch (err) {
        logger.error({ err }, 'Failed to send DM');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PUT /api/dms/:id/read
// ============================================================================
// Mark a DM as read.
//
// Headers: Authorization: Bearer {token}
// Returns: { success: boolean }
// ============================================================================
router.put('/:id/read', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const dmId = req.params.id;

        // Only the recipient can mark a DM as read
        const result = await query(
            `UPDATE dms SET is_read = TRUE
             WHERE id = $1 AND recipient_id = $2
             RETURNING id`,
            [dmId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'DM not found or you are not the recipient.',
            });
        }

        return res.json({ success: true });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to mark DM as read');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/dms/unread/count
// ============================================================================
// Get the count of unread DMs for the authenticated user.
//
// Headers: Authorization: Bearer {token}
// Returns: { count: number }
// ============================================================================
router.get('/unread/count', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await query(
            'SELECT COUNT(*)::int AS count FROM dms WHERE recipient_id = $1 AND is_read = FALSE',
            [userId]
        );

        return res.json({ count: result.rows[0].count });
    } catch (err) {
        logger.error({ err }, 'Failed to fetch unread count');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
