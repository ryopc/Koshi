// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// WebSocket Message Handlers
// License: MIT
// ============================================================================
// Handles incoming WebSocket messages from connected clients.
// Supports posting, following, and sending DMs directly via WebSocket.
// ============================================================================

import { query } from '../db/pool.js';
import { broadcast, broadcastToGroup } from './index.js';
import { logger } from '../logger.js';

// Dynamic P2P import (only if P2P module is available)
let _p2pModule = null;
async function getP2P() {
    if (!_p2pModule) {
        try {
            _p2pModule = await import('../p2p/index.js');
        } catch {
            _p2pModule = { isReady: () => false, appendPost: async () => false, appendDM: async () => false };
        }
    }
    return _p2pModule;
}

/**
 * Handle an incoming WebSocket message.
 *
 * @param {import('ws').WebSocket} ws - The sender's socket
 * @param {object} message - Parsed JSON message { type, payload }
 * @param {{ userId: string, username: string }} user - Authenticated user info
 */
export async function handleMessage(ws, message, user) {
    const { type, payload } = message;

    if (!type) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Message must include a "type" field.' },
        }));
        return;
    }

    try {
        switch (type) {
            case 'ping':
                handlePing(ws);
                break;

            case 'post:create':
                await handlePostCreate(ws, payload, user);
                break;

            case 'dm:send':
                await handleDmSend(ws, payload, user);
                break;

            case 'follow':
                await handleFollow(ws, payload, user);
                break;

            case 'unfollow':
                await handleUnfollow(ws, payload, user);
                break;

            case 'group:create':
                await handleGroupCreate(ws, payload, user);
                break;

            case 'group:update':
                await handleGroupUpdate(ws, payload, user);
                break;

            case 'group:delete':
                await handleGroupDelete(ws, payload, user);
                break;

            case 'group:invite':
                await handleGroupInvite(ws, payload, user);
                break;

            case 'group:leave':
                await handleGroupLeave(ws, payload, user);
                break;

            case 'group:message':
                await handleGroupMessage(ws, payload, user);
                break;

            case 'group:read':
                await handleGroupMessageRead(ws, payload, user);
                break;

            case 'typing:start':
                await handleTypingStart(ws, payload, user);
                break;

            case 'typing:stop':
                await handleTypingStop(ws, payload, user);
                break;

            case 'key_bundle:request':
                await handleKeyBundleRequest(ws, payload, user);
                break;

            case 'p2p:status':
                await handleP2PStatus(ws, user);
                break;

            case 'p2p:sync':
                await handleP2PSync(ws, user);
                break;

            default:
                ws.send(JSON.stringify({
                    type: 'error',
                    payload: { message: `Unknown message type: "${type}".` },
                }));
        }
    } catch (err) {
        logger.error({ err, type, userId: user.userId }, 'WebSocket handler error');
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: `Error processing message: ${err.message}` },
        }));
    }
}

/**
 * Handle ping — responds with pong (for latency measurement).
 */
function handlePing(ws) {
    ws.send(JSON.stringify({
        type: 'pong',
        payload: { timestamp: new Date().toISOString() },
    }));
}

/**
 * Handle post creation via WebSocket.
 *
 * @param {import('ws').WebSocket} ws
 * @param {object} payload - { content: string, signature: string }
 * @param {{ userId: string, username: string }} user
 */
async function handlePostCreate(ws, payload, user) {
    const { content, signature } = payload || {};

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Content is required and cannot be empty.' },
        }));
        return;
    }

    if (content.trim().length > 2000) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Content exceeds 2000 characters.' },
        }));
        return;
    }

    if (!signature || typeof signature !== 'string') {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Signature is required.' },
        }));
        return;
    }

    const result = await query(
        `INSERT INTO kb_posts (author_id, content, signature)
         VALUES ($1, $2, $3)
         RETURNING id, content, signature, created_at`,
        [user.userId, content.trim(), signature]
    );

    const post = result.rows[0];

    // Get author info
    const authorResult = await query(
        'SELECT id, username, display_name FROM users WHERE id = $1',
        [user.userId]
    );
    const author = authorResult.rows[0];

    const postEvent = {
        id: post.id,
        author: {
            id: author.id,
            username: author.username,
            displayName: author.display_name,
        },
        content: post.content,
        signature: post.signature,
        timestamp: post.created_at,
    };

    // Confirm to sender
    ws.send(JSON.stringify({
        type: 'post:created',
        payload: postEvent,
    }));

    // Broadcast to all other clients
    broadcast('post_created', postEvent);

    // Append to P2P store (best-effort)
    try {
        const p2p = await getP2P();
        if (p2p.isReady()) {
            await p2p.appendPost({
                id: postEvent.id,
                content: postEvent.content,
                author: postEvent.author,
                signature: postEvent.signature,
                createdAt: postEvent.timestamp,
            });
        }
    } catch {
        // P2P append is best-effort
    }
}

/**
 * Handle DM sending via WebSocket.
 *
 * @param {import('ws').WebSocket} ws
 * @param {object} payload - { recipientId: string, content: string, signature: string }
 * @param {{ userId: string, username: string }} user
 */
async function handleDmSend(ws, payload, user) {
    const { recipientId, content, signature } = payload || {};

    if (!recipientId || typeof recipientId !== 'string') {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'recipientId is required.' },
        }));
        return;
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Content is required and cannot be empty.' },
        }));
        return;
    }

    if (content.trim().length > 5000) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Content exceeds 5000 characters.' },
        }));
        return;
    }

    if (!signature) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Signature is required.' },
        }));
        return;
    }

    if (user.userId === recipientId) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Cannot send a DM to yourself.' },
        }));
        return;
    }

    // Verify recipient exists
    const recipientCheck = await query('SELECT id, username FROM users WHERE id = $1', [recipientId]);
    if (recipientCheck.rows.length === 0) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Recipient not found.' },
        }));
        return;
    }

    const result = await query(
        `INSERT INTO dms (sender_id, recipient_id, content, signature)
         VALUES ($1, $2, $3, $4)
         RETURNING id, content, signature, is_read, created_at`,
        [user.userId, recipientId, content.trim(), signature]
    );

    const dm = result.rows[0];

    const dmEvent = {
        id: dm.id,
        from: { id: user.userId, username: user.username },
        content: dm.content,
        signature: dm.signature,
        timestamp: dm.created_at,
    };

    // Confirm to sender
    ws.send(JSON.stringify({
        type: 'dm:sent',
        payload: dmEvent,
    }));

    // Deliver to recipient via WebSocket
    broadcast('dm_received', dmEvent, recipientId);

    // Append to P2P store (best-effort)
    try {
        const p2p = await getP2P();
        if (p2p.isReady()) {
            await p2p.appendDM({
                id: dmEvent.id,
                content: dmEvent.content,
                fromUsername: user.username,
                signature: dmEvent.signature,
                createdAt: dmEvent.timestamp,
            });
        }
    } catch {
        // P2P append is best-effort
    }
}

/**
 * Handle follow via WebSocket.
 */
async function handleFollow(ws, payload, user) {
    const { userId: targetUserId } = payload || {};

    if (!targetUserId) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'userId (target) is required.' },
        }));
        return;
    }

    if (user.userId === targetUserId) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Cannot follow yourself.' },
        }));
        return;
    }

    // Check if already following
    const existing = await query(
        'SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2',
        [user.userId, targetUserId]
    );

    if (existing.rows.length > 0) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Already following this user.' },
        }));
        return;
    }

    await query(
        'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)',
        [user.userId, targetUserId]
    );

    ws.send(JSON.stringify({
        type: 'follow:done',
        payload: { success: true, followingId: targetUserId },
    }));

    // Notify the followed user
    broadcast('follow_notification', {
        follower: { id: user.userId, username: user.username },
        following: { id: targetUserId },
    }, targetUserId);
}

/**
 * Handle unfollow via WebSocket.
 */
async function handleUnfollow(ws, payload, user) {
    const { userId: targetUserId } = payload || {};

    if (!targetUserId) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'userId (target) is required.' },
        }));
        return;
    }

    const result = await query(
        'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2 RETURNING id',
        [user.userId, targetUserId]
    );

    if (result.rows.length === 0) {
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Follow relationship not found.' },
        }));
        return;
    }

    ws.send(JSON.stringify({
        type: 'unfollow:done',
        payload: { success: true, followingId: targetUserId },
    }));
}

/**
 * Handle P2P status request via WebSocket.
 */
async function handleP2PStatus(ws, user) {
    try {
        const p2p = await getP2P();
        if (!p2p) {
            ws.send(JSON.stringify({
                type: 'p2p:status',
                payload: { available: false, ready: false, status: 'not_available' },
            }));
            return;
        }

        const status = p2p.getP2PStatus();
        ws.send(JSON.stringify({
            type: 'p2p:status',
            payload: { available: true, ...status },
        }));
    } catch (err) {
        logger.warn({ err }, 'Failed to get P2P status via WS');
        ws.send(JSON.stringify({
            type: 'p2p:status',
            payload: { available: false, ready: false, status: 'error' },
        }));
    }
}

/**
 * Handle P2P manual sync request via WebSocket.
 */
async function handleP2PSync(ws, user) {
    try {
        const p2p = await getP2P();
        if (!p2p) {
            ws.send(JSON.stringify({
                type: 'p2p:sync',
                payload: { success: false, message: 'P2P not available' },
            }));
            return;
        }

        if (!p2p.isReady()) {
            const started = await p2p.initP2PNode();
            if (!started) {
                ws.send(JSON.stringify({
                    type: 'p2p:sync',
                    payload: { success: false, message: 'Failed to start P2P node' },
                }));
                return;
            }
        }

        const status = p2p.getP2PStatus();
        ws.send(JSON.stringify({
            type: 'p2p:sync',
            payload: { success: true, status },
        }));
    } catch (err) {
        logger.warn({ err }, 'Failed to sync P2P via WS');
        ws.send(JSON.stringify({
            type: 'p2p:sync',
            payload: { success: false, message: err.message },
        }));
    }
}

/**
 * Handle group creation via WebSocket.
 * Payload: { name, description?, memberUserIds: string[], avatarUrl? }
 */
async function handleGroupCreate(ws, payload, user) {
    const { name, description, memberUserIds, avatarUrl } = payload || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Group name is required.' } }));
        return;
    }
    if (name.trim().length > 128) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Group name exceeds 128 characters.' } }));
        return;
    }
    if (!Array.isArray(memberUserIds) || memberUserIds.length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'At least one member (including yourself) is required.' } }));
        return;
    }
    if (memberUserIds.length > 100) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Maximum 100 members allowed per group.' } }));
        return;
    }
    if (!memberUserIds.includes(user.userId)) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'You must include yourself in the member list.' } }));
        return;
    }

    const client = await (await import('../db/pool.js')).getClient();
    try {
        await client.query('BEGIN');

        // Verify all users exist
        const placeholders = memberUserIds.map((_, i) => `$${i + 1}`).join(',');
        const usersResult = await client.query(
            `SELECT id FROM users WHERE id IN (${placeholders})`,
            memberUserIds
        );
        if (usersResult.rows.length !== memberUserIds.length) {
            await client.query('ROLLBACK');
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'One or more users not found.' } }));
            return;
        }

        // Create group
        const groupResult = await client.query(
            `INSERT INTO groups (name, description, avatar_url, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, description, avatar_url, created_by, is_e2ee, created_at, updated_at`,
            [name.trim(), description?.trim() || null, avatarUrl || null, user.userId]
        );
        const group = groupResult.rows[0];

        // Add members (creator as admin, others as member)
        for (const memberId of memberUserIds) {
            const role = memberId === user.userId ? 'admin' : 'member';
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

        // Confirm to sender
        ws.send(JSON.stringify({
            type: 'group:created',
            payload: { group: groupResponse, members },
        }));

        // Broadcast group_created to all other members
        for (const member of members) {
            if (member.user.id !== user.userId) {
                broadcast('group_created', { group: groupResponse, members }, member.user.id);
            }
        }

        logger.info({ groupId: group.id, creatorId: user.userId, memberCount: members.length }, 'Group created via WS');
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err }, 'Failed to create group via WS');
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Failed to create group.' } }));
    } finally {
        client.release();
    }
}

/**
 * Handle group update via WebSocket.
 * Payload: { groupId, name?, description?, avatarUrl? }
 */
async function handleGroupUpdate(ws, payload, user) {
    const { groupId, name, description, avatarUrl } = payload || {};

    if (!groupId) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'groupId is required.' } }));
        return;
    }

    const isAdmin = await checkGroupAdmin(groupId, user.userId);
    if (!isAdmin) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Only group admins can update group info.' } }));
        return;
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Group name cannot be empty.' } }));
            return;
        }
        if (name.trim().length > 128) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Group name exceeds 128 characters.' } }));
            return;
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
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Avatar URL too long (max 512 chars).' } }));
            return;
        }
        updates.push(`avatar_url = $${paramIndex++}`);
        values.push(avatarUrl || null);
    }

    if (updates.length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'No fields to update.' } }));
        return;
    }

    values.push(groupId);
    const result = await query(
        `UPDATE groups SET ${updates.join(', ')}, updated_at = NOW()
         WHERE id = $${paramIndex}
         RETURNING id, name, description, avatar_url, created_by, is_e2ee, created_at, updated_at`,
        values
    );

    if (result.rows.length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Group not found.' } }));
        return;
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

    // Confirm to sender
    ws.send(JSON.stringify({ type: 'group:updated', payload: { groupId, changes: groupResponse } }));

    // Broadcast to all members
    await broadcastToGroup(groupId, 'group_updated', { groupId, changes: groupResponse });

    logger.info({ groupId, updatedBy: user.userId }, 'Group updated via WS');
}

/**
 * Handle group deletion via WebSocket.
 * Payload: { groupId }
 */
async function handleGroupDelete(ws, payload, user) {
    const { groupId } = payload || {};

    if (!groupId) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'groupId is required.' } }));
        return;
    }

    const isAdmin = await checkGroupAdmin(groupId, user.userId);
    if (!isAdmin) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Only group admins can delete the group.' } }));
        return;
    }

    const result = await query('DELETE FROM groups WHERE id = $1 RETURNING id', [groupId]);
    if (result.rows.length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Group not found.' } }));
        return;
    }

    // Confirm to sender
    ws.send(JSON.stringify({ type: 'group:deleted', payload: { groupId } }));

    // Broadcast to all members
    await broadcastToGroup(groupId, 'group_deleted', { groupId });

    logger.info({ groupId, deletedBy: user.userId }, 'Group deleted via WS');
}

/**
 * Handle group invite (add members) via WebSocket.
 * Payload: { groupId, userIds: string[] }
 */
async function handleGroupInvite(ws, payload, user) {
    const { groupId, userIds } = payload || {};

    if (!groupId || !Array.isArray(userIds) || userIds.length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'groupId and userIds array are required.' } }));
        return;
    }
    if (userIds.length > 50) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Maximum 50 members can be added at once.' } }));
        return;
    }

    const isAdmin = await checkGroupAdmin(groupId, user.userId);
    if (!isAdmin) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Only group admins can invite members.' } }));
        return;
    }

    // Verify group exists
    const groupCheck = await query('SELECT id FROM groups WHERE id = $1', [groupId]);
    if (groupCheck.rows.length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Group not found.' } }));
        return;
    }

    // Verify users exist
    const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
    const usersResult = await query(`SELECT id FROM users WHERE id IN (${placeholders})`, userIds);
    if (usersResult.rows.length !== userIds.length) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'One or more users not found.' } }));
        return;
    }

    const addedMembers = [];
    for (const memberId of userIds) {
        const result = await query(
            `INSERT INTO group_members (group_id, user_id, role)
             VALUES ($1, $2, 'member')
             ON CONFLICT (group_id, user_id) DO UPDATE SET role = 'member'
             RETURNING id, group_id, user_id, role, joined_at`,
            [groupId, memberId]
        );
        if (result.rows.length > 0) {
            const member = result.rows[0];
            const userResult = await query('SELECT id, username, display_name, avatar_url, bio, is_admin, created_at FROM users WHERE id = $1', [memberId]);
            if (userResult.rows.length > 0) {
                const u = userResult.rows[0];
                const memberData = {
                    id: member.id,
                    groupId: member.group_id,
                    role: member.role,
                    joinedAt: member.joined_at,
                    user: { id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, avatarUrl: u.avatar_url, isAdmin: u.is_admin, createdAt: u.created_at },
                };
                addedMembers.push(memberData);

                // Broadcast to all members
                await broadcastToGroup(groupId, 'group_member_added', { groupId, member: memberData, addedBy: user.userId });
            }
        }
    }

    ws.send(JSON.stringify({ type: 'group:invited', payload: { members: addedMembers } }));
    logger.info({ groupId, addedBy: user.userId, count: addedMembers.length }, 'Members invited via WS');
}

/**
 * Handle group leave (remove self) or admin remove member via WebSocket.
 * Payload: { groupId, userId? } - if userId omitted, current user leaves
 */
async function handleGroupLeave(ws, payload, user) {
    const { groupId, userId: targetUserId } = payload || {};
    const currentUserId = user.userId;

    if (!groupId) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'groupId is required.' } }));
        return;
    }

    const membership = await checkGroupMembership(groupId, currentUserId);
    if (!membership) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'You are not a member of this group.' } }));
        return;
    }

    const isAdmin = membership.role === 'admin';
    const isSelf = !targetUserId || targetUserId === currentUserId;
    const removeUserId = isSelf ? currentUserId : targetUserId;

    if (!isAdmin && !isSelf) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Only admins can remove other members.' } }));
        return;
    }

    // Prevent admin from removing themselves if they're the only admin
    if (isSelf && isAdmin) {
        const adminCount = await query('SELECT COUNT(*)::int as count FROM group_members WHERE group_id = $1 AND role = \'admin\'', [groupId]);
        if (adminCount.rows[0].count === 1) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Cannot remove the only admin. Promote another member first.' } }));
            return;
        }
    }

    // Check target is a member
    const targetMembership = await checkGroupMembership(groupId, removeUserId);
    if (!targetMembership) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'User is not a member of this group.' } }));
        return;
    }

    await query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, removeUserId]);

    // Confirm to sender
    ws.send(JSON.stringify({ type: 'group:left', payload: { groupId, userId: removeUserId } }));

    // Broadcast to all members (including removed user)
    await broadcastToGroup(groupId, 'group_member_removed', { groupId, userId: removeUserId, removedBy: currentUserId }, removeUserId);

    logger.info({ groupId, removedUserId: removeUserId, removedBy: currentUserId }, 'Member left/removed via WS');
}

/**
 * Handle group message via WebSocket.
 * Payload: { groupId, content, signature, messageType?, replyTo? }
 */
async function handleGroupMessage(ws, payload, user) {
    const { groupId, content, signature, messageType, replyTo } = payload || {};

    if (!groupId) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'groupId is required.' } }));
        return;
    }

    const membership = await checkGroupMembership(groupId, user.userId);
    if (!membership) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'You are not a member of this group.' } }));
        return;
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Content is required.' } }));
        return;
    }
    if (content.trim().length > 5000) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Content exceeds 5000 characters.' } }));
        return;
    }
    if (!signature || typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Valid signature required (128-char hex).' } }));
        return;
    }

    const validTypes = ['text', 'image', 'file', 'system'];
    const msgType = messageType && validTypes.includes(messageType) ? messageType : 'text';

    if (replyTo) {
        const replyCheck = await query('SELECT id FROM group_messages WHERE id = $1 AND group_id = $2', [replyTo, groupId]);
        if (replyCheck.rows.length === 0) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Reply target message not found in this group.' } }));
            return;
        }
    }

    const result = await query(
        `INSERT INTO group_messages (group_id, sender_id, content, signature, message_type, reply_to)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, group_id, content, signature, message_type, reply_to, created_at`,
        [groupId, user.userId, content.trim(), signature, msgType, replyTo || null]
    );

    const msg = result.rows[0];

    const senderResult = await query('SELECT id, username, display_name FROM users WHERE id = $1', [user.userId]);
    const sender = senderResult.rows[0];

    const messageResponse = {
        id: msg.id,
        groupId: msg.group_id,
        sender: { id: sender.id, username: sender.username, displayName: sender.display_name },
        content: msg.content,
        signature: msg.signature,
        messageType: msg.message_type,
        replyTo: msg.reply_to,
        createdAt: msg.created_at,
    };

    // Confirm to sender
    ws.send(JSON.stringify({ type: 'group:message:sent', payload: messageResponse }));

    // Broadcast to all group members (including sender for multi-device sync)
    await broadcastToGroup(groupId, 'group_message', { message: messageResponse, groupId });

    logger.info({ groupId, messageId: msg.id, senderId: user.userId }, 'Group message sent via WS');
}

/**
 * Handle group message read receipt via WebSocket.
 * Payload: { groupId, messageId }
 */
async function handleGroupMessageRead(ws, payload, user) {
    const { groupId, messageId } = payload || {};

    if (!groupId || !messageId) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'groupId and messageId are required.' } }));
        return;
    }

    const membership = await checkGroupMembership(groupId, user.userId);
    if (!membership) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'You are not a member of this group.' } }));
        return;
    }

    // Verify message exists in this group
    const msgCheck = await query('SELECT id FROM group_messages WHERE id = $1 AND group_id = $2', [messageId, groupId]);
    if (msgCheck.rows.length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Message not found.' } }));
        return;
    }

    // Upsert read receipt
    await query(
        `INSERT INTO message_read_receipts (message_id, message_type, user_id)
         VALUES ($1, 'group', $2)
         ON CONFLICT (message_id, message_type, user_id) DO NOTHING`,
        [messageId, user.userId]
    );

    // Broadcast group_message_read
    await broadcastToGroup(groupId, 'group_message_read', {
        groupId,
        messageId,
        userId: user.userId,
        readAt: new Date().toISOString(),
    });

    ws.send(JSON.stringify({ type: 'group:read:done', payload: { success: true } }));
}

/**
 * Handle typing start via WebSocket.
 * Payload: { conversationId, conversationType: 'dm' | 'group' }
 */
async function handleTypingStart(ws, payload, user) {
    const { conversationId, conversationType } = payload || {};

    if (!conversationId || !conversationType || !['dm', 'group'].includes(conversationType)) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'conversationId and conversationType (dm|group) required.' } }));
        return;
    }

    if (conversationType === 'group') {
        const membership = await checkGroupMembership(conversationId, user.userId);
        if (!membership) {
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'You are not a member of this group.' } }));
            return;
        }
    }

    // Broadcast to others in conversation
    if (conversationType === 'group') {
        await broadcastToGroup(conversationId, 'typing_start', {
            conversationId,
            conversationType,
            userId: user.userId,
            username: user.username,
        }, user.userId);
    } else {
        // DM: broadcast to the other user
        // We need to find the other participant from conversationId
        // For simplicity, assume conversationId is the other user's ID for DMs
        broadcast('typing_start', {
            conversationId,
            conversationType,
            userId: user.userId,
            username: user.username,
        }, conversationId);
    }
}

/**
 * Handle typing stop via WebSocket.
 * Payload: { conversationId, conversationType: 'dm' | 'group' }
 */
async function handleTypingStop(ws, payload, user) {
    const { conversationId, conversationType } = payload || {};

    if (!conversationId || !conversationType || !['dm', 'group'].includes(conversationType)) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'conversationId and conversationType (dm|group) required.' } }));
        return;
    }

    if (conversationType === 'group') {
        await broadcastToGroup(conversationId, 'typing_stop', {
            conversationId,
            conversationType,
            userId: user.userId,
            username: user.username,
        }, user.userId);
    } else {
        broadcast('typing_stop', {
            conversationId,
            conversationType,
            userId: user.userId,
            username: user.username,
        }, conversationId);
    }
}

/**
 * Handle key bundle request via WebSocket.
 * Payload: { targetUserId }
 */
async function handleKeyBundleRequest(ws, payload, user) {
    const { targetUserId } = payload || {};

    if (!targetUserId) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'targetUserId is required.' } }));
        return;
    }

    if (user.userId === targetUserId) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Cannot request key bundle for yourself.' } }));
        return;
    }

    // Get target user's latest device
    const deviceResult = await query(
        `SELECT * FROM user_devices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [targetUserId]
    );

    if (deviceResult.rows.length === 0) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'No devices found for target user.' } }));
        return;
    }

    const device = deviceResult.rows[0];
    const oneTimePreKeys = device.one_time_pre_keys || [];

    // Consume one one-time prekey
    let consumedPreKey = null;
    let updatedPreKeys = [...oneTimePreKeys];
    if (updatedPreKeys.length > 0) {
        consumedPreKey = updatedPreKeys.shift();
        await query('UPDATE user_devices SET one_time_pre_keys = $1 WHERE id = $2', [updatedPreKeys, device.id]);
    }

    const bundle = {
        identityKey: device.identity_key,
        signedPreKey: device.signed_pre_key,
        preKeySignature: device.pre_key_signature,
        oneTimePreKeys: consumedPreKey ? [consumedPreKey] : [],
    };

    ws.send(JSON.stringify({
        type: 'key_bundle_response',
        payload: { userId: targetUserId, bundle },
    }));
}

/**
 * Check if user is a member of a group.
 */
async function checkGroupMembership(groupId, userId) {
    const result = await query('SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
    return result.rows[0] || null;
}

/**
 * Check if user is admin of a group.
 */
async function checkGroupAdmin(groupId, userId) {
    const membership = await checkGroupMembership(groupId, userId);
    return membership && membership.role === 'admin';
}
