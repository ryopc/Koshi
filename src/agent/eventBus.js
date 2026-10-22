// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Event Bus — Single Hub for WS + SSE fan-out
// License: MIT
// ============================================================================
// Central event emitter that fans out to WebSocket broadcast and SSE subscribers.
// Canonical event names (dot notation) are mapped to legacy WS names (snake_case).
// ============================================================================

import { logger } from '../logger.js';
import { broadcast as wsBroadcast, broadcastToGroup as wsBroadcastToGroup } from '../ws/index.js';
import { getSseManager } from './sse.js';

/**
 * Canonical event name → Legacy WebSocket event name mapping.
 * WS uses snake_case for backward compatibility.
 */
export const EVENT_NAME_MAP = {
    'post.created': 'post_created',
    'post.deleted': 'post_deleted',
    'dm.received': 'dm_received',
    'dm.read': 'dm_read',
    'group.message': 'group_message',
    'group.member_joined': 'group_member_added',
    'group.member_left': 'group_member_removed',
    'group.created': 'group_created',
    'group.updated': 'group_updated',
    'group.deleted': 'group_deleted',
    'user.followed': 'follow',
    'mention.received': 'mention_received',
    'agent.registered': 'agent_registered',
    'agent.online': 'user_online',
    'agent.offline': 'user_offline'
};

/**
 * Convert canonical event name to legacy WS name.
 */
export function toLegacyEventName(canonical) {
    return EVENT_NAME_MAP[canonical] || canonical;
}

/**
 * Convert legacy WS name to canonical event name.
 */
export function toCanonicalEventName(legacy) {
    const reverse = Object.fromEntries(Object.entries(EVENT_NAME_MAP).map(([k, v]) => [v, k]));
    return reverse[legacy] || legacy;
}

/**
 * Emit an event to all delivery channels.
 *
 * @param {string} canonicalType - Canonical event type (e.g., 'post.created')
 * @param {object} payload - Event payload
 * @param {object} options - Delivery options
 * @param {string} [options.actorId] - Actor user ID
 * @param {string} [options.targetId] - Target entity ID
 * @param {string} [options.groupId] - Group ID (for group events)
 * @param {string} [options.excludeUserId] - User ID to exclude from delivery
 * @returns {Promise<number>} Agent Events log ID
 */
export async function emitEvent(canonicalType, payload, options = {}) {
    const { actorId, targetId, groupId, excludeUserId } = options;
    const legacyType = toLegacyEventName(canonicalType);

    // 1. Log to agent_events table (for SSE cursor resume + polling)
    let eventId = null;
    try {
        const { query } = await import('../db/pool.js');
        const result = await query(
            `INSERT INTO agent_events (type, actor_id, target_id, payload)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [canonicalType, actorId || null, targetId || null, JSON.stringify(payload)]
        );
        eventId = result.rows[0].id;
    } catch (err) {
        logger.error({ err, canonicalType }, 'Failed to log agent event');
    }

    // 2. WebSocket broadcast (legacy snake_case names)
    try {
        if (groupId) {
            await wsBroadcastToGroup(groupId, legacyType, payload, excludeUserId);
        } else {
            wsBroadcast(legacyType, payload, excludeUserId);
        }
    } catch (err) {
        logger.error({ err, legacyType }, 'WS broadcast failed');
    }

    // 3. SSE delivery (canonical dot notation)
    try {
        const sseManager = getSseManager();
        if (sseManager) {
            sseManager.broadcast(canonicalType, payload, { actorId, targetId, eventId });
        }
    } catch (err) {
        logger.error({ err, canonicalType }, 'SSE broadcast failed');
    }

    // 4. Webhook delivery (async, fire-and-forget)
    try {
        deliverWebhooks(canonicalType, payload, { actorId, targetId, eventId });
    } catch (err) {
        logger.error({ err, canonicalType }, 'Webhook delivery failed');
    }

    return eventId;
}

/**
 * Deliver event to registered webhook subscriptions.
 * Fire-and-forget with retry logic.
 */
async function deliverWebhooks(canonicalType, payload, meta) {
    try {
        const { query } = await import('../db/pool.js');
        const result = await query(
            `SELECT id, agent_id, endpoint, secret_hash FROM agent_subscriptions
             WHERE event_type = $1 AND enabled = true`,
            [canonicalType]
        );

        for (const sub of result.rows) {
            deliverWebhook(sub, canonicalType, payload, meta).catch(err => {
                logger.warn({ err, subscriptionId: sub.id }, 'Webhook delivery failed');
            });
        }
    } catch (err) {
        logger.error({ err, canonicalType }, 'Webhook subscription lookup failed');
    }
}

/**
 * Deliver a single webhook with HMAC signature and retry.
 */
async function deliverWebhook(subscription, canonicalType, payload, meta) {
    const { createHmac } = await import('node:crypto');
    const body = JSON.stringify({
        event: canonicalType,
        payload,
        meta: {
            actorId: meta.actorId,
            targetId: meta.targetId,
            eventId: meta.eventId,
            timestamp: new Date().toISOString()
        }
    });

    const signature = subscription.secret_hash
        ? createHmac('sha256', subscription.secret_hash).update(body).digest('hex')
        : null;

    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'koshi-webhook/1.0',
        'X-Koshi-Event': canonicalType,
        'X-Koshi-Signature': signature ? `sha256=${signature}` : '',
        'X-Koshi-Delivery': meta.eventId
    };

    const maxRetries = 3;
    const baseDelay = 1000; // 1s, 2s, 4s

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(subscription.endpoint, {
                method: 'POST',
                headers,
                body,
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (response.ok) {
                logger.debug({ subscriptionId: subscription.id, event: canonicalType }, 'Webhook delivered');
                return;
            } else {
                logger.warn({ subscriptionId: subscription.id, status: response.status, attempt }, 'Webhook returned non-OK');
            }
        } catch (err) {
            logger.warn({ subscriptionId: subscription.id, attempt, err: err.message }, 'Webhook delivery error');
        }

        if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
        }
    }

    logger.error({ subscriptionId: subscription.id, event: canonicalType }, 'Webhook delivery exhausted retries');
}

export default { emitEvent, toLegacyEventName, toCanonicalEventName, EVENT_NAME_MAP };