// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Admin API Routes
// License: MIT
// ============================================================================
// Provides administrative endpoints for managing the koshi board.
// All routes require authentication AND admin privileges.
//
// Admin users are designated via:
//   1. ADMIN_USERNAME environment variable (sets first admin)
//   2. Database is_admin flag: UPDATE users SET is_admin = TRUE WHERE username = '...';
// ============================================================================

import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();

// All admin routes require admin privileges
router.use(requireAdmin);

// ============================================================================
// GET /api/admin/users
// ============================================================================
// List all registered users with their details.
//
// Query: ?limit=50&offset=0
// Headers: Authorization: Bearer {token}
// Returns: { users: [...], total: number }
// ============================================================================
router.get('/users', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);

        const [usersResult, countResult] = await Promise.all([
            query(
                `SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.bio,
                    u.avatar_url,
                    u.is_admin,
                    u.created_at,
                    u.updated_at,
                    (SELECT COUNT(*) FROM follows WHERE following_id = u.id)::int AS followers_count,
                    (SELECT COUNT(*) FROM follows WHERE follower_id = u.id)::int AS following_count,
                    (SELECT COUNT(*) FROM kb_posts WHERE author_id = u.id)::int AS posts_count
                FROM users u
                ORDER BY u.created_at DESC
                LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
            query('SELECT COUNT(*)::int AS total FROM users'),
        ]);

        return res.json({
            users: usersResult.rows.map((row) => ({
                id: row.id,
                username: row.username,
                displayName: row.display_name,
                bio: row.bio,
                avatarUrl: row.avatar_url,
                isAdmin: row.is_admin,
                followersCount: row.followers_count,
                followingCount: row.following_count,
                postsCount: row.posts_count,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            })),
            total: countResult.rows[0].total,
        });
    } catch (err) {
        logger.error({ err }, 'Failed to list users (admin)');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/admin/users/:id
// ============================================================================
// Get detailed info about a specific user (admin view).
//
// Headers: Authorization: Bearer {token}
// Returns: { user object with all details }
// ============================================================================
router.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await query(
            `SELECT
                u.id,
                u.username,
                u.public_key,
                u.display_name,
                u.bio,
                u.avatar_url,
                u.is_admin,
                u.created_at,
                u.updated_at,
                (SELECT COUNT(*) FROM follows WHERE following_id = u.id)::int AS followers_count,
                (SELECT COUNT(*) FROM follows WHERE follower_id = u.id)::int AS following_count,
                (SELECT COUNT(*) FROM kb_posts WHERE author_id = u.id)::int AS posts_count,
                (SELECT COUNT(*) FROM dms WHERE sender_id = u.id OR recipient_id = u.id)::int AS dms_count
            FROM users u
            WHERE u.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const user = result.rows[0];

        return res.json({
            id: user.id,
            username: user.username,
            publicKey: user.public_key,
            displayName: user.display_name,
            bio: user.bio,
            avatarUrl: user.avatar_url,
            isAdmin: user.is_admin,
            followersCount: user.followers_count,
            followingCount: user.following_count,
            postsCount: user.posts_count,
            dmsCount: user.dms_count,
            createdAt: user.created_at,
            updatedAt: user.updated_at,
        });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch user details (admin)');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// DELETE /api/admin/users/:id
// ============================================================================
// Permanently delete a user account and all associated data.
// Posts, follows, and DMs are cascade-deleted by the database.
//
// Headers: Authorization: Bearer {token}
// Returns: { success: true, deletedUser: { username, id } }
// ============================================================================
router.delete('/users/:id', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const adminUserId = req.user.userId;

        // Prevent admin from deleting themselves
        if (targetUserId === adminUserId) {
            return res.status(400).json({ error: 'Cannot delete your own account. Use an admin account to remove another admin.' });
        }

        // Fetch user info before deletion for the response
        const userResult = await query(
            'SELECT id, username FROM users WHERE id = $1',
            [targetUserId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const deletedUser = userResult.rows[0];

        // Delete the user — all related data (posts, follows, DMs) is cascade-deleted
        await query('DELETE FROM users WHERE id = $1', [targetUserId]);

        logger.info(
            { targetUserId, targetUsername: deletedUser.username, adminUserId },
            'User deleted by admin'
        );

        return res.json({
            success: true,
            deletedUser: {
                id: deletedUser.id,
                username: deletedUser.username,
            },
        });
    } catch (err) {
        logger.error({ err }, 'Failed to delete user (admin)');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PUT /api/admin/users/:id/admin
// ============================================================================
// Toggle admin status for a user (grant or revoke admin privileges).
//
// Body: { isAdmin: boolean }
// Headers: Authorization: Bearer {token}
// Returns: { success: true, user: { id, username, isAdmin } }
// ============================================================================
router.put('/users/:id/admin', async (req, res) => {
    try {
        const targetUserId = req.params.id;
        const { isAdmin } = req.body;

        if (typeof isAdmin !== 'boolean') {
            return res.status(400).json({ error: 'isAdmin must be a boolean.' });
        }

        // Prevent admin from revoking their own admin status
        if (targetUserId === req.user.userId && !isAdmin) {
            return res.status(400).json({ error: 'Cannot revoke your own admin privileges.' });
        }

        const result = await query(
            `UPDATE users SET is_admin = $1 WHERE id = $2
             RETURNING id, username, is_admin`,
            [isAdmin, targetUserId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const user = result.rows[0];

        logger.info(
            { targetUserId, targetUsername: user.username, isAdmin: user.is_admin, adminUserId: req.user.userId },
            'Admin status updated'
        );

        return res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                isAdmin: user.is_admin,
            },
        });
    } catch (err) {
        logger.error({ err }, 'Failed to toggle admin status');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
