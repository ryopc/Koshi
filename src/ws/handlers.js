// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// WebSocket Message Handlers
// License: MIT
// ============================================================================
// Handles incoming WebSocket messages from connected clients.
// Supports posting, following, and sending DMs directly via WebSocket.
// ============================================================================

import { query } from '../db/pool.js';
import { broadcast } from './index.js';
import { logger } from '../logger.js';

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
