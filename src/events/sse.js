// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// SSE (Server-Sent Events) Manager
// License: MIT
// ============================================================================
// Manages SSE connections, handles Last-Event-ID resume, heartbeat,
// and fan-out from eventBus.
// ============================================================================

import { query } from '../db/pool.js';
import { logger } from '../logger.js';

/** @type {Map<string, Set<import('http').ServerResponse>>} */
const connections = new Map();

/** @type {import('events').EventEmitter|null} */
let sseManagerInstance = null;

/**
 * SSE Connection Manager
 */
class SseManager {
    constructor() {
        this.retryInterval = 3000; // ms
        this.maxBacklog = 100;     // events to flush on connect
        this.heartbeatInterval = 15000; // 15s
    }

    /**
     * Initialize SSE for a request.
     * Sets headers, sends initial backlog, registers connection.
     */
    async initialize(req, res) {
        // SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no' // Disable nginx buffering
        });

        // Send retry interval
        res.write(`retry: ${this.retryInterval}\n\n`);

        // Parse filters
        const types = req.query.types ? req.query.types.split(',') : null;
        const since = req.query.since ? parseInt(req.query.since, 10) : null;
        const limit = req.query.limit ? Math.min(parseInt(req.query.limit, 10), 500) : this.maxBacklog;

        const userId = req.user?.userId;
        const isAgent = req.user?.isAgent;

        // Create connection ID
        const connId = `${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        // Register connection
        if (!connections.has(userId)) {
            connections.set(userId, new Set());
        }
        connections.get(userId).add({ id: connId, res, types, userId, isAgent });

        // Send backlog (events since `since` or last N)
        if (since || limit > 0) {
            await this.sendBacklog(res, userId, isAgent, types, since, limit);
        }

        // Send initial heartbeat
        res.write(`: connected\n\n`);

        // Cleanup on close
        req.on('close', () => {
            const conns = connections.get(userId);
            if (conns) {
                for (const c of conns) {
                    if (c.id === connId) {
                        conns.delete(c);
                        break;
                    }
                }
                if (conns.size === 0) connections.delete(userId);
            }
        });

        logger.debug({ connId, userId, types, since }, 'SSE connection established');
    }

    /**
     * Send historical events (backlog) on connection.
     */
    async sendBacklog(res, userId, isAgent, types, since, limit) {
        try {
            let where = 'WHERE 1=1';
            const params = [];

            // Filter by user's access - agents can see all, users see events they're involved in
            // For simplicity, we show all events to authenticated users
            // In production, you might want to filter by visibility

            if (since) {
                params.push(since);
                where += ` AND id > $${params.length}`;
            }

            if (types && types.length > 0) {
                params.push(types);
                where += ` AND type = ANY($${params.length})`;
            }

            params.push(limit);
            const result = await query(
                `SELECT id, type, actor_id, target_id, payload, created_at
                 FROM agent_events ${where}
                 ORDER BY id ASC
                 LIMIT $${params.length}`,
                params
            );

            for (const row of result.rows) {
                this.writeEvent(res, row.id.toString(), row.type, row.payload);
            }

            logger.debug({ userId, count: result.rows.length }, 'SSE backlog sent');
        } catch (err) {
            logger.error({ err, userId }, 'Failed to send SSE backlog');
        }
    }

    /**
     * Write a single SSE event.
     */
    writeEvent(res, id, event, data) {
        res.write(`id: ${id}\n`);
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    /**
     * Broadcast an event to matching connections.
     */
    broadcast(canonicalType, payload, meta = {}) {
        const { actorId, targetId, eventId } = meta;
        const eventData = { ...payload };
        if (actorId) eventData.actorId = actorId;
        if (targetId) eventData.targetId = targetId;

        for (const [userId, conns] of connections) {
            for (const conn of conns) {
                // Filter by event types if specified
                if (conn.types && !conn.types.includes(canonicalType)) continue;

                // Don't send to the actor themselves (optional - depends on use case)
                // if (conn.userId === actorId) continue;

                try {
                    this.writeEvent(conn.res, eventId?.toString() || '', canonicalType, eventData);
                } catch (err) {
                    logger.warn({ err, userId }, 'SSE write failed');
                }
            }
        }
    }

    /**
     * Start heartbeat interval.
     */
    startHeartbeat() {
        if (this.heartbeatTimer) return;
        this.heartbeatTimer = setInterval(() => {
            for (const [userId, conns] of connections) {
                for (const conn of conns) {
                    try {
                        conn.res.write(`: keepalive\n\n`);
                    } catch {
                        // Ignore write errors
                    }
                }
            }
        }, this.heartbeatInterval);
    }

    /**
     * Get connection stats.
     */
    getStats() {
        let total = 0;
        for (const conns of connections.values()) {
            total += conns.size;
        }
        return { totalConnections: total, uniqueUsers: connections.size };
    }
}

/**
 * Get or create the singleton SSE manager.
 */
export function getSseManager() {
    if (!sseManagerInstance) {
        sseManagerInstance = new SseManager();
        sseManagerInstance.startHeartbeat();
    }
    return sseManagerInstance;
}

/**
 * Express middleware to handle SSE requests.
 */
export async function sseMiddleware(req, res, next) {
    const accept = req.headers.accept || '';
    if (!accept.includes('text/event-stream')) {
        return next(); // Not an SSE request
    }

    const manager = getSseManager();
    await manager.initialize(req, res);
    // Don't call next() - we handle the response fully
}

export default { getSseManager, sseMiddleware };