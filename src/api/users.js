// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// User Management API Routes
// License: MIT
// ============================================================================
// Provides endpoints for viewing profiles, updating profiles,
// following/unfollowing users, and listing followers/following.
// ============================================================================

import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// GET /api/users/search/:query
// ============================================================================
// Search users by username or display name.
// IMPORTANT: Must be defined BEFORE /:username so Express matches it first.
//
// Returns: [ { id, username, displayName, avatarUrl } ]
// ============================================================================
router.get('/search/:query', async (req, res) => {
    try {
        const { query: searchQuery } = req.params;

        if (!searchQuery || searchQuery.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters.' });
        }

        const result = await query(
            `SELECT id, username, display_name, avatar_url
             FROM users
             WHERE username ILIKE $1 OR display_name ILIKE $1
             ORDER BY
                CASE WHEN username ILIKE $2 THEN 0 ELSE 1 END,
                username
             LIMIT 20`,
            [`%${searchQuery}%`, `${searchQuery}%`]
        );

        return res.json(
            result.rows.map((row) => ({
                id: row.id,
                username: row.username,
                displayName: row.display_name,
                avatarUrl: row.avatar_url,
            }))
        );
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to search users');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/users/:username
// ============================================================================
// Fetch a user's public profile.
//
// Returns: { id, username, displayName, bio, avatarUrl, followersCount, followingCount }
// ============================================================================
router.get('/:username', async (req, res) => {
    try {
        const { username } = req.params;

        if (!username || typeof username !== 'string') {
            return res.status(400).json({ error: 'Username parameter is required.' });
        }

        const result = await query(
            `SELECT
                u.id,
                u.username,
                u.display_name,
                u.bio,
                u.avatar_url,
                u.created_at,
                (SELECT COUNT(*) FROM follows WHERE following_id = u.id)::int AS followers_count,
                (SELECT COUNT(*) FROM follows WHERE follower_id = u.id)::int AS following_count
            FROM users u
            WHERE u.username = $1`,
            [username.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];

        return res.json({
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            bio: user.bio,
            avatarUrl: user.avatar_url,
            followersCount: user.followers_count,
            followingCount: user.following_count,
            createdAt: user.created_at,
        });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch user profile');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PUT /api/users/me
// ============================================================================
// Update the authenticated user's profile.
//
// Headers: Authorization: Bearer {token}
// Body: { displayName?: string, bio?: string, avatarUrl?: string }
// Returns: { updated user object }
// ============================================================================
router.put('/me', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { displayName, bio, avatarUrl } = req.body;

        // Build dynamic update query — only update provided fields
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (displayName !== undefined) {
            if (typeof displayName !== 'string' || displayName.length > 64) {
                return res.status(400).json({ error: 'Display name must be a string (max 64 characters).' });
            }
            updates.push(`display_name = $${paramIndex++}`);
            values.push(displayName.trim());
        }

        if (bio !== undefined) {
            if (typeof bio !== 'string' || bio.length > 500) {
                return res.status(400).json({ error: 'Bio must be a string (max 500 characters).' });
            }
            updates.push(`bio = $${paramIndex++}`);
            values.push(bio.trim());
        }

        if (avatarUrl !== undefined) {
            if (typeof avatarUrl !== 'string' || avatarUrl.length > 512) {
                return res.status(400).json({ error: 'Avatar URL must be a string (max 512 characters).' });
            }
            // Basic URL validation
            try {
                new URL(avatarUrl);
            } catch {
                return res.status(400).json({ error: 'Avatar URL must be a valid URL.' });
            }
            updates.push(`avatar_url = $${paramIndex++}`);
            values.push(avatarUrl);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update. Provide at least one of: displayName, bio, avatarUrl.' });
        }

        values.push(userId);
        const updateQuery = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, display_name, bio, avatar_url, created_at, updated_at`;

        const result = await query(updateQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const user = result.rows[0];
        logger.info({ userId }, 'Profile updated');

        return res.json({
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            bio: user.bio,
            avatarUrl: user.avatar_url,
            createdAt: user.created_at,
            updatedAt: user.updated_at,
        });
    } catch (err) {
        logger.error({ err }, 'Failed to update profile');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/users/:id/followers
// ============================================================================
// Get list of users following the specified user.
//
// Returns: [ { id, username, displayName } ]
// ============================================================================
router.get('/:id/followers', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            `SELECT u.id, u.username, u.display_name
             FROM follows f
             JOIN users u ON u.id = f.follower_id
             WHERE f.following_id = $1
             ORDER BY f.created_at DESC`,
            [id]
        );

        return res.json(
            result.rows.map((row) => ({
                id: row.id,
                username: row.username,
                displayName: row.display_name,
            }))
        );
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch followers');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/users/:id/following
// ============================================================================
// Get list of users that the specified user follows.
//
// Returns: [ { id, username, displayName } ]
// ============================================================================
router.get('/:id/following', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            `SELECT u.id, u.username, u.display_name
             FROM follows f
             JOIN users u ON u.id = f.following_id
             WHERE f.follower_id = $1
             ORDER BY f.created_at DESC`,
            [id]
        );

        return res.json(
            result.rows.map((row) => ({
                id: row.id,
                username: row.username,
                displayName: row.display_name,
            }))
        );
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch following');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/users/:id/follow
// ============================================================================
// Follow a user.
//
// Headers: Authorization: Bearer {token}
// Returns: { success: boolean }
// ============================================================================
router.post('/:id/follow', requireAuth, async (req, res) => {
    try {
        const followerId = req.user.userId;
        const followingId = req.params.id;

        if (followerId === followingId) {
            return res.status(400).json({ error: 'You cannot follow yourself.' });
        }

        // Check if already following
        const existing = await query(
            'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
            [followerId, followingId]
        );

        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Already following this user.' });
        }

        // Check the target user exists
        const targetUser = await query('SELECT id FROM users WHERE id = $1', [followingId]);
        if (targetUser.rows.length === 0) {
            return res.status(404).json({ error: 'User to follow not found.' });
        }

        await query(
            'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)',
            [followerId, followingId]
        );

        logger.info({ followerId, followingId }, 'User followed');

        return res.json({ success: true });
    } catch (err) {
        logger.error({ err }, 'Failed to follow user');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// DELETE /api/users/:id/follow
// ============================================================================
// Unfollow a user.
//
// Headers: Authorization: Bearer {token}
// Returns: { success: boolean }
// ============================================================================
router.delete('/:id/follow', requireAuth, async (req, res) => {
    try {
        const followerId = req.user.userId;
        const followingId = req.params.id;

        const result = await query(
            'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2 RETURNING id',
            [followerId, followingId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Follow relationship not found.' });
        }

        logger.info({ followerId, followingId }, 'User unfollowed');

        return res.json({ success: true });
    } catch (err) {
        logger.error({ err }, 'Failed to unfollow user');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
