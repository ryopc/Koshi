// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Groups API Routes
// License: MIT
// ============================================================================
// Handles group chat functionality: create, update, delete, members, messages.
// All groups are E2EE (is_e2ee = true) as required by Pito.
// ============================================================================

import { Router } from 'express';
import { query, getClient } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { getBroadcast } from '../ws/index.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if user is a member of a group
 */
async function checkGroupMembership(groupId, userId) {
    const result = await query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
    );
    return result.rows[0] || null;
}

/**
 * Check if user is admin of a group
 */
async function checkGroupAdmin(groupId, userId) {
    const membership = await checkGroupMembership(groupId, userId);
    return membership && membership.role === 'admin';
}

/**
 * Get group with member count and current user's role
 */
async function getGroupWithMeta(groupId, userId) {
    const result = await query(
        `SELECT
            g.*,
            (SELECT COUNT(*) FROM group_members WHERE group_id = g.id)::int AS member_count,
            gm.role AS my_role
         FROM groups g
         LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
         WHERE g.id = $1`,
        [groupId, userId]
    );
    return result.rows[0] || null;
}

/**
 * Broadcast to all group members (excluding sender optionally)
 */
async function broadcastToGroup(groupId, event, payload, excludeUserId = null) {
    const broadcast = getBroadcast();
    if (!broadcast) return;

    // Get all member user IDs
    const membersResult = await query(
        'SELECT user_id FROM group_members WHERE group_id = $1',
        [groupId]
    );

    for (const member of membersResult.rows) {
        if (member.user_id !== excludeUserId) {
            broadcast(event, payload, member.user_id);
        }
    }
}

// ============================================================================
// GET /api/groups
// ============================================================================
// List groups the authenticated user is a member of.
// Query: ?limit=50&offset=0
// Returns: [ { id, name, description, avatarUrl, createdBy, isE2EE, createdAt, updatedAt, memberCount, myRole } ]
// ============================================================================
router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);

        const result = await query(
            `SELECT
                g.id, g.name, g.description, g.avatar_url, g.created_by, g.is_e2ee, g.created_at, g.updated_at,
                (SELECT COUNT(*) FROM group_members WHERE group_id = g.id)::int AS member_count,
                gm.role AS my_role
             FROM groups g
             JOIN group_members gm ON gm.group_id = g.id
             WHERE gm.user_id = $1
             ORDER BY g.updated_at DESC
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );

        return res.json(
            result.rows.map((row) => ({
                id: row.id,
                name: row.name,
                description: row.description,
                avatarUrl: row.avatar_url,
                createdBy: row.created_by,
                isE2EE: row.is_e2ee,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                memberCount: row.member_count,
                myRole: row.my_role,
            }))
        );
    } catch (err) {
        logger.error({ err }, 'Failed to fetch groups');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/groups
// ============================================================================
// Create a new group.
// Body: { name, description?, memberUserIds: string[], avatarUrl? }
// Returns: { group, members }
// ============================================================================
router.post('/', requireAuth, async (req, res) => {
    const client = await getClient();
    try {
        const userId = req.user.userId;
        const { name, description, memberUserIds, avatarUrl } = req.body;

        // Validation
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Group name is required.' });
        }
        if (name.trim().length > 128) {
            return res.status(400).json({ error: 'Group name exceeds 128 characters.' });
        }
        if (!Array.isArray(memberUserIds) || memberUserIds.length === 0) {
            return res.status(400).json({ error: 'At least one member (including yourself) is required.' });
        }
        if (memberUserIds.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 members allowed per group.' });
        }
        if (!memberUserIds.includes(userId)) {
            return res.status(400).json({ error: 'You must include yourself in the member list.' });
        }
        if (avatarUrl && (typeof avatarUrl !== 'string' || avatarUrl.length > 512)) {
            return res.status(400).json({ error: 'Avatar URL too long (max 512 chars).' });
        }

        await client.query('BEGIN');

        // Verify all users exist
        const placeholders = memberUserIds.map((_, i) => `$${i + 1}`).join(',');
        const usersResult = await client.query(
            `SELECT id FROM users WHERE id IN (${placeholders})`,
            memberUserIds
        );
        if (usersResult.rows.length !== memberUserIds.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'One or more users not found.' });
        }

        // Create group
        const groupResult = await client.query(
            `INSERT INTO groups (name, description, avatar_url, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, description, avatar_url, created_by, is_e2ee, created_at, updated_at`,
            [name.trim(), description?.trim() || null, avatarUrl || null, userId]
        );
        const group = groupResult.rows[0];

        // Add members (creator as admin, others as member)
        for (const memberId of memberUserIds) {
            const role = memberId === userId ? 'admin' : 'member';
            await client.query(
                `INSERT INTO group_members (group_id, user_id, role)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
                [group.id, memberId, role]
            );
        }

        await client.query('COMMIT');

        // Fetch created group with members
        const membersResult = await query(
            `SELECT
                gm.id, gm.group_id, gm.role, gm.joined_at,
                u.id as user_id, u.username, u.display_name, u.avatar_url, u.bio, u.is_admin, u.created_at
             FROM group_members gm
             JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = $1
             ORDER BY gm.role DESC, gm.joined_at`,
            [group.id]
        );

        const groupResponse = {
            id: group.id,
            name: group.name,
            description: group.description,
            avatarUrl: group.avatar_url,
            createdBy: group.created_by,
            isE2EE: group.is_e2ee,
            createdAt: group.created_at,
            updatedAt: group.updated_at,
            memberCount: membersResult.rows.length,
            myRole: 'admin',
        };

        const members = membersResult.rows.map((row) => ({
            id: row.id,
            groupId: row.group_id,
            role: row.role,
            joinedAt: row.joined_at,
            user: {
                id: row.user_id,
                username: row.username,
                displayName: row.display_name,
                bio: row.bio,
                avatarUrl: row.avatar_url,
                isAdmin: row.is_admin,
                createdAt: row.created_at,
            },
        }));

        // Broadcast group_created to all members
        try {
            const broadcast = getBroadcast();
            if (broadcast) {
                for (const member of members) {
                    if (member.user.id !== userId) {
                        broadcast('group_created', { group: groupResponse, members }, member.user.id);
                    }
                }
            }
        } catch (wsErr) {
            logger.warn({ err: wsErr }, 'Failed to broadcast group_created');
        }

        logger.info({ groupId: group.id, creatorId: userId, memberCount: members.length }, 'Group created');
        return res.status(201).json({ group: groupResponse, members });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err }, 'Failed to create group');
        return res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ============================================================================
// GET /api/groups/:id
// ============================================================================
// Get group details with members and latest message.
// Returns: { group, members, latestMessage? }
// ============================================================================
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const groupId = req.params.id;

        // Check membership
        const membership = await checkGroupMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'You are not a member of this group.' });
        }

        // Get group with meta
        const group = await getGroupWithMeta(groupId, userId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        // Get members
        const membersResult = await query(
            `SELECT
                gm.id, gm.group_id, gm.role, gm.joined_at,
                u.id as user_id, u.username, u.display_name, u.avatar_url, u.bio, u.is_admin, u.created_at
             FROM group_members gm
             JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = $1
             ORDER BY gm.role DESC, gm.joined_at`,
            [groupId]
        );

        // Get latest message
        const latestMsgResult = await query(
            `SELECT
                gm.id, gm.group_id, gm.content, gm.signature, gm.message_type, gm.reply_to, gm.created_at,
                u.id as sender_id, u.username as sender_username, u.display_name as sender_display_name
             FROM group_messages gm
             JOIN users u ON u.id = gm.sender_id
             WHERE gm.group_id = $1
             ORDER BY gm.created_at DESC
             LIMIT 1`,
            [groupId]
        );

        const members = membersResult.rows.map((row) => ({
            id: row.id,
            groupId: row.group_id,
            role: row.role,
            joinedAt: row.joined_at,
            user: {
                id: row.user_id,
                username: row.username,
                displayName: row.display_name,
                bio: row.bio,
                avatarUrl: row.avatar_url,
                isAdmin: row.is_admin,
                createdAt: row.created_at,
            },
        }));

        let latestMessage = null;
        if (latestMsgResult.rows.length > 0) {
            const msg = latestMsgResult.rows[0];
            latestMessage = {
                id: msg.id,
                groupId: msg.group_id,
                sender: {
                    id: msg.sender_id,
                    username: msg.sender_username,
                    displayName: msg.sender_display_name,
                },
                content: msg.content,
                signature: msg.signature,
                messageType: msg.message_type,
                replyTo: msg.reply_to,
                createdAt: msg.created_at,
            };
        }

        return res.json({
            group: {
                id: group.id,
                name: group.name,
                description: group.description,
                avatarUrl: group.avatar_url,
                createdBy: group.created_by,
                isE2EE: group.is_e2ee,
                createdAt: group.created_at,
                updatedAt: group.updated_at,
                memberCount: members.length,
                myRole: group.my_role,
            },
            members,
            latestMessage,
        });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch group');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PATCH /api/groups/:id
// ============================================================================
// Update group info (admin only).
// Body: { name?, description?, avatarUrl? }
// Returns: { group }
// ============================================================================
router.patch('/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const groupId = req.params.id;
        const { name, description, avatarUrl } = req.body;

        const isAdmin = await checkGroupAdmin(groupId, userId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only group admins can update group info.' });
        }

        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name !== undefined) {
            if (typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: 'Group name cannot be empty.' });
            }
            if (name.trim().length > 128) {
                return res.status(400).json({ error: 'Group name exceeds 128 characters.' });
            }
            updates.push(`name = $${paramIndex++}`);
            values.push(name.trim());
        }

        if (description !== undefined) {
            updates.push(`description = $${paramIndex++}`);
            values.push(description?.trim() || null);
        }

        if (avatarUrl !== undefined) {
            if (avatarUrl && (typeof avatarUrl !== 'string' || avatarUrl.length > 512)) {
                return res.status(400).json({ error: 'Avatar URL too long (max 512 chars).' });
            }
            updates.push(`avatar_url = $${paramIndex++}`);
            values.push(avatarUrl || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update.' });
        }

        values.push(groupId);
        const result = await query(
            `UPDATE groups SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${paramIndex}
             RETURNING id, name, description, avatar_url, created_by, is_e2ee, created_at, updated_at`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        const group = result.rows[0];
        const groupResponse = {
            id: group.id,
            name: group.name,
            description: group.description,
            avatarUrl: group.avatar_url,
            createdBy: group.created_by,
            isE2EE: group.is_e2ee,
            createdAt: group.created_at,
            updatedAt: group.updated_at,
        };

        // Broadcast group_updated to all members
        await broadcastToGroup(groupId, 'group_updated', { groupId, changes: groupResponse });

        logger.info({ groupId, updatedBy: userId }, 'Group updated');
        return res.json({ group: groupResponse });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to update group');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// DELETE /api/groups/:id
// ============================================================================
// Delete group (admin only).
// Returns: { success: boolean }
// ============================================================================
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const groupId = req.params.id;

        const isAdmin = await checkGroupAdmin(groupId, userId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only group admins can delete the group.' });
        }

        const result = await query('DELETE FROM groups WHERE id = $1 RETURNING id', [groupId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        // Broadcast group_deleted to all members
        await broadcastToGroup(groupId, 'group_deleted', { groupId });

        logger.info({ groupId, deletedBy: userId }, 'Group deleted');
        return res.json({ success: true });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to delete group');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/groups/:id/members
// ============================================================================
// Invite members to group (admin only).
// Body: { userIds: string[] }
// Returns: { members: GroupMember[] }
// ============================================================================
router.post('/:id/members', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const groupId = req.params.id;
        const { userIds } = req.body;

        const isAdmin = await checkGroupAdmin(groupId, userId);
        if (!isAdmin) {
            return res.status(403).json({ error: 'Only group admins can invite members.' });
        }

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ error: 'userIds array is required.' });
        }
        if (userIds.length > 50) {
            return res.status(400).json({ error: 'Maximum 50 members can be added at once.' });
        }

        // Verify group exists
        const groupCheck = await query('SELECT id FROM groups WHERE id = $1', [groupId]);
        if (groupCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }

        // Verify users exist
        const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
        const usersResult = await query(
            `SELECT id FROM users WHERE id IN (${placeholders})`,
            userIds
        );
        if (usersResult.rows.length !== userIds.length) {
            return res.status(400).json({ error: 'One or more users not found.' });
        }

        const addedMembers = [];
        for (const memberId of userIds) {
            // Insert or update membership
            const result = await query(
                `INSERT INTO group_members (group_id, user_id, role)
                 VALUES ($1, $2, 'member')
                 ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'member'
                 RETURNING id, group_id, user_id, role, joined_at`,
                [groupId, memberId]
            );
            if (result.rows.length > 0) {
                const member = result.rows[0];
                // Fetch user details
                const userResult = await query(
                    'SELECT id, username, display_name, avatar_url, bio, is_admin, created_at FROM users WHERE id = $1',
                    [memberId]
                );
                if (userResult.rows.length > 0) {
                    const u = userResult.rows[0];
                    addedMembers.push({
                        id: member.id,
                        groupId: member.group_id,
                        role: member.role,
                        joinedAt: member.joined_at,
                        user: {
                            id: u.id,
                            username: u.username,
                            displayName: u.display_name,
                            bio: u.bio,
                            avatarUrl: u.avatar_url,
                            isAdmin: u.is_admin,
                            createdAt: u.created_at,
                        },
                    });

                    // Broadcast group_member_added
                    await broadcastToGroup(groupId, 'group_member_added', {
                        groupId,
                        member: addedMembers[addedMembers.length - 1],
                        addedBy: userId,
                    });
                }
            }
        }

        logger.info({ groupId, addedBy: userId, count: addedMembers.length }, 'Members added to group');
        return res.status(201).json({ members: addedMembers });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to add members');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// DELETE /api/groups/:id/members/:userId
// ============================================================================
// Remove member from group (admin can remove others, users can remove themselves).
// Returns: { success: boolean }
// ============================================================================
router.delete('/:id/members/:userId', requireAuth, async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        const groupId = req.params.id;
        const targetUserId = req.params.userId;

        const membership = await checkGroupMembership(groupId, currentUserId);
        if (!membership) {
            return res.status(403).json({ error: 'You are not a member of this group.' });
        }

        const isAdmin = membership.role === 'admin';
        const isSelf = currentUserId === targetUserId;

        if (!isAdmin && !isSelf) {
            return res.status(403).json({ error: 'Only admins can remove other members.' });
        }

        // Prevent admin from removing themselves if they're the only admin
        if (isSelf && isAdmin) {
            const adminCount = await query(
                'SELECT COUNT(*)::int as count FROM group_members WHERE group_id = $1 AND role = \'admin\'',
                [groupId]
            );
            if (adminCount.rows[0].count === 1) {
                return res.status(400).json({ error: 'Cannot remove the only admin. Promote another member first.' });
            }
        }

        // Check target is a member
        const targetMembership = await checkGroupMembership(groupId, targetUserId);
        if (!targetMembership) {
            return res.status(404).json({ error: 'User is not a member of this group.' });
        }

        await query(
            'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
            [groupId, targetUserId]
        );

        // Broadcast group_member_removed
        await broadcastToGroup(groupId, 'group_member_removed', {
            groupId,
            userId: targetUserId,
            removedBy: currentUserId,
        }, targetUserId); // Also send to the removed user

        logger.info({ groupId, removedUserId: targetUserId, removedBy: currentUserId }, 'Member removed from group');
        return res.json({ success: true });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to remove member');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/groups/:id/messages
// ============================================================================
// Get group message history (paginated).
// Query: ?limit=50&offset=0&before=<messageId>
// Returns: [GroupMessage]
// ============================================================================
router.get('/:id/messages', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const groupId = req.params.id;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const before = req.query.before;

        const membership = await checkGroupMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'You are not a member of this group.' });
        }

        let sql = `
            SELECT
                gm.id, gm.group_id, gm.content, gm.signature, gm.message_type, gm.reply_to, gm.created_at,
                u.id as sender_id, u.username as sender_username, u.display_name as sender_display_name
            FROM group_messages gm
            JOIN users u ON u.id = gm.sender_id
            WHERE gm.group_id = $1
        `;
        const params = [groupId];
        let paramIndex = 2;

        if (before) {
            // Cursor pagination: get messages before the given message ID
            sql += ` AND gm.created_at < (SELECT created_at FROM group_messages WHERE id = $${paramIndex})`;
            params.push(before);
            paramIndex++;
        }

        sql += ` ORDER BY gm.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);

        const result = await query(sql, params);

        const messages = result.rows.map((row) => ({
            id: row.id,
            groupId: row.group_id,
            sender: {
                id: row.sender_id,
                username: row.sender_username,
                displayName: row.sender_display_name,
            },
            content: row.content,
            signature: row.signature,
            messageType: row.message_type,
            replyTo: row.reply_to,
            createdAt: row.created_at,
        }));

        return res.json(messages);
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch group messages');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/groups/:id/messages
// ============================================================================
// Send a message to the group.
// Body: { content, signature, messageType?, replyTo? }
// Returns: { message }
// ============================================================================
router.post('/:id/messages', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const groupId = req.params.id;
        const { content, signature, messageType, replyTo } = req.body;

        const membership = await checkGroupMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'You are not a member of this group.' });
        }

        // Validation
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            return res.status(400).json({ error: 'Content is required.' });
        }
        if (content.trim().length > 5000) {
            return res.status(400).json({ error: 'Content exceeds 5000 characters.' });
        }
        if (!signature || typeof signature !== 'string') {
            return res.status(400).json({ error: 'Signature is required.' });
        }
        if (!/^[0-9a-f]{128}$/i.test(signature)) {
            return res.status(400).json({ error: 'Invalid signature format (must be 128-char hex).' });
        }

        const validTypes = ['text', 'image', 'file', 'system'];
        const msgType = messageType && validTypes.includes(messageType) ? messageType : 'text';

        if (replyTo) {
            const replyCheck = await query(
                'SELECT id FROM group_messages WHERE id = $1 AND group_id = $2',
                [replyTo, groupId]
            );
            if (replyCheck.rows.length === 0) {
                return res.status(400).json({ error: 'Reply target message not found in this group.' });
            }
        }

        const result = await query(
            `INSERT INTO group_messages (group_id, sender_id, content, signature, message_type, reply_to)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, group_id, content, signature, message_type, reply_to, created_at`,
            [groupId, userId, content.trim(), signature, msgType, replyTo || null]
        );

        const msg = result.rows[0];

        // Get sender info
        const senderResult = await query(
            'SELECT id, username, display_name FROM users WHERE id = $1',
            [userId]
        );
        const sender = senderResult.rows[0];

        const messageResponse = {
            id: msg.id,
            groupId: msg.group_id,
            sender: {
                id: sender.id,
                username: sender.username,
                displayName: sender.display_name,
            },
            content: msg.content,
            signature: msg.signature,
            messageType: msg.message_type,
            replyTo: msg.reply_to,
            createdAt: msg.created_at,
        };

        // Broadcast to all group members (including sender for confirmation)
        await broadcastToGroup(groupId, 'group_message', { message: messageResponse, groupId });

        logger.info({ groupId, messageId: msg.id, senderId: userId }, 'Group message sent');
        return res.status(201).json({ message: messageResponse });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to send group message');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// PUT /api/groups/:id/messages/:msgId/read
// ============================================================================
// Mark a group message as read.
// Returns: { success: boolean }
// ============================================================================
router.put('/:id/messages/:msgId/read', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const groupId = req.params.id;
        const messageId = req.params.msgId;

        const membership = await checkGroupMembership(groupId, userId);
        if (!membership) {
            return res.status(403).json({ error: 'You are not a member of this group.' });
        }

        // Verify message exists in this group
        const msgCheck = await query(
            'SELECT id FROM group_messages WHERE id = $1 AND group_id = $2',
            [messageId, groupId]
        );
        if (msgCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found.' });
        }

        // Upsert read receipt
        await query(
            `INSERT INTO message_read_receipts (message_id, message_type, user_id)
             VALUES ($1, 'group', $2)
             ON CONFLICT (message_id, message_type, user_id) DO NOTHING`,
            [messageId, userId]
        );

        // Broadcast group_message_read
        await broadcastToGroup(groupId, 'group_message_read', {
            groupId,
            messageId,
            userId,
            readAt: new Date().toISOString(),
        });

        return res.json({ success: true });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to mark group message as read');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;