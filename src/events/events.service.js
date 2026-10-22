// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Events Service — Event Log Management
// License: MIT
// ============================================================================
// Handles event logging, retrieval, TTL-based purging.
// ============================================================================

import { query } from '../db/pool.js';
import { logger } from '../logger.js';

/**
 * Record an event to the agent_events log.
 * Called by emitEvent() in eventBus.js
 */
export async function recordEvent(type, payload, meta = {}) {
    const { actorId, targetId } = meta;
    try {
        const result = await query(
            `INSERT INTO agent_events (type, actor_id, target_id, payload)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [type, actorId || null, targetId || null, JSON.stringify(payload || {})]
        );
        return result.rows[0].id;
    } catch (err) {
        logger.error({ err, type }, 'Failed to record event');
        return null;
    }
}

/**
 * Get events with filtering and pagination.
 * Supports both SSE cursor resume and polling fallback.
 */
export async function getEvents({ types, since, limit = 100, actorId }) {
    let where = 'WHERE 1=1';
    const params = [];

    if (since) {
        params.push(since);
        where += ` AND id > $${params.length}`;
    }

    if (types && types.length > 0) {
        params.push(types);
        where += ` AND type = ANY($${params.length})`;
    }

    if (actorId) {
        params.push(actorId);
        where += ` AND actor_id = $${params.length}`;
    }

    params.push(Math.min(limit, 500));
    const result = await query(
        `SELECT id, type, actor_id, target_id, payload, created_at
         FROM agent_events ${where}
         ORDER BY id ASC
         LIMIT $${params.length}`,
        params
    );

    return result.rows.map(row => ({
        id: row.id,
        type: row.type,
        actorId: row.actor_id,
        targetId: row.target_id,
        payload: row.payload,
        createdAt: row.created_at
    }));
}

/**
 * Purge old events based on TTL.
 * Runs on startup and via daily cron.
 */
export async function purgeOldEvents(olderThanDays = 30) {
    try {
        const result = await query(
            `DELETE FROM agent_events
             WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'`
        );
        logger.info({ deleted: result.rowCount, olderThanDays }, 'Purged old events');
        return result.rowCount;
    } catch (err) {
        logger.error({ err }, 'Failed to purge old events');
        return 0;
    }
}

/**
 * Start periodic purge job (daily).
 */
export function startPurgeJob(olderThanDays = 30) {
    // Run once on startup
    setImmediate(() => purgeOldEvents(olderThanDays));

    // Then daily
    setInterval(() => {
        purgeOldEvents(olderThanDays);
    }, 24 * 60 * 60 * 1000);
}

/**
 * Get event statistics.
 */
export async function getEventStats() {
    const result = await query(`
        SELECT
            type,
            COUNT(*) as count,
            MIN(created_at) as oldest,
            MAX(created_at) as newest
        FROM agent_events
        GROUP BY type
        ORDER BY count DESC
    `);

    const totalResult = await query('SELECT COUNT(*) as total FROM agent_events');

    return {
        total: parseInt(totalResult.rows[0].total, 10),
        byType: result.rows.map(row => ({
            type: row.type,
            count: parseInt(row.count, 10),
            oldest: row.oldest,
            newest: row.newest
        }))
    };
}

export default { recordEvent, getEvents, purgeOldEvents, startPurgeJob, getEventStats };