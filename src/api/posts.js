// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Posts API Routes (Koshi Board)
// License: MIT
// ============================================================================
// Handles creation and retrieval of kb_posts.
// All posts require an ed25519 signature for authenticity.
// ============================================================================

import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { postLimiter } from '../middleware/rateLimit.js';
import { getBroadcast } from '../ws/index.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// GET /api/posts/feed
// ============================================================================
// Fetch the post feed. Shows posts from users the authenticated user follows,
// plus the user's own posts. Falls back to global feed if not authenticated.
//
// Query: ?limit=20&offset=0
// Headers: Authorization: Bearer {token} (optional — without token, shows global feed)
// Returns: [ { id, author, content, signature, createdAt } ]
// ============================================================================
router.get('/feed', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const userId = req.user?.userId;

        let result;

        if (userId) {
            // Personalized feed: posts from followed users + own posts
            result = await query(
                `SELECT
                    p.id,
                    p.content,
                    p.signature,
                    p.created_at,
                    u.id AS author_id,
                    u.username AS author_username,
                    u.display_name AS author_display_name
                FROM kb_posts p
                JOIN users u ON u.id = p.author_id
                WHERE p.author_id = $1
                   OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
                ORDER BY p.created_at DESC
                LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );
        } else {
            // Global feed
            result = await query(
                `SELECT
                    p.id,
                    p.content,
                    p.signature,
                    p.created_at,
                    u.id AS author_id,
                    u.username AS author_username,
                    u.display_name AS author_display_name
                FROM kb_posts p
                JOIN users u ON u.id = p.author_id
                ORDER BY p.created_at DESC
                LIMIT $1 OFFSET $2`,
                [limit, offset]
            );
        }

        return res.json(
            result.rows.map((row) => ({
                id: row.id,
                author: {
                    id: row.author_id,
                    username: row.author_username,
                    displayName: row.author_display_name,
                },
                content: row.content,
                signature: row.signature,
                createdAt: row.created_at,
            }))
        );
    } catch (err) {
        logger.error({ err }, 'Failed to fetch feed');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/posts
// ============================================================================
// Create a new post on the koshi board.
//
// Headers: Authorization: Bearer {token}
// Body: { content: string, signature: string }
// The signature is an ed25519 signature of the content string.
// Returns: { id, author, content, signature, createdAt }
// ============================================================================
router.post('/', requireAuth, postLimiter, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { content, signature } = req.body;

        // -- Input validation --
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'Content is required and must be a string.' });
        }

        const trimmedContent = content.trim();

        if (trimmedContent.length === 0) {
            return res.status(400).json({ error: 'Content cannot be empty.' });
        }

        if (trimmedContent.length > 2000) {
            return res.status(400).json({ error: 'Content exceeds maximum length of 2000 characters.' });
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

        // -- Insert post --
        const result = await query(
            `INSERT INTO kb_posts (author_id, content, signature)
             VALUES ($1, $2, $3)
             RETURNING id, content, signature, created_at`,
            [userId, trimmedContent, signature]
        );

        const post = result.rows[0];

        // Fetch author info
        const authorResult = await query(
            'SELECT id, username, display_name FROM users WHERE id = $1',
            [userId]
        );
        const author = authorResult.rows[0];

        const postResponse = {
            id: post.id,
            author: {
                id: author.id,
                username: author.username,
                displayName: author.display_name,
            },
            content: post.content,
            signature: post.signature,
            createdAt: post.created_at,
        };

        // Broadcast via WebSocket
        try {
            const broadcast = getBroadcast();
            if (broadcast) {
                broadcast('post_created', {
                    ...postResponse,
                    timestamp: post.created_at,
                });
            }
        } catch (wsErr) {
            // WebSocket broadcast is best-effort
            logger.warn({ err: wsErr }, 'Failed to broadcast post via WebSocket');
        }

        logger.info({ postId: post.id, userId }, 'Post created');

        return res.status(201).json(postResponse);
    } catch (err) {
        logger.error({ err }, 'Failed to create post');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/posts/:id
// ============================================================================
// Fetch a single post by ID.
//
// Returns: { id, author, content, signature, createdAt }
// ============================================================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            `SELECT
                p.id,
                p.content,
                p.signature,
                p.created_at,
                u.id AS author_id,
                u.username AS author_username,
                u.display_name AS author_display_name
             FROM kb_posts p
             JOIN users u ON u.id = p.author_id
             WHERE p.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Post not found.' });
        }

        const row = result.rows[0];

        return res.json({
            id: row.id,
            author: {
                id: row.author_id,
                username: row.author_username,
                displayName: row.author_display_name,
            },
            content: row.content,
            signature: row.signature,
            createdAt: row.created_at,
        });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch post');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
