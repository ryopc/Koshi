// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// WebSocket Server
// License: MIT
// ============================================================================
// Provides real-time communication for the koshi board.
// Clients connect at ws://host:port/ws?token={jwt}
// Supports broadcast to all or targeted delivery to specific users.
// ============================================================================

import { WebSocketServer } from 'ws';
import { verifyToken } from '../auth/jwt.js';
import { logger } from '../logger.js';
import { handleMessage } from './handlers.js';

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const userSockets = new Map();

/** @type {Map<import('ws').WebSocket, { userId: string, username: string }>} */
const socketUsers = new Map();

/** @type {WebSocketServer|null} */
let wss = null;

/**
 * Initialize the WebSocket server.
 * Attaches to an existing HTTP server.
 *
 * @param {import('http').Server} server - The HTTP server instance
 * @returns {WebSocketServer}
 */
export function initWebSocket(server) {
    wss = new WebSocketServer({
        server,
        path: '/ws',
        maxPayload: 1024 * 100,  // 100KB max message size
    });

    wss.on('connection', (ws, req) => {
        handleConnection(ws, req);
    });

    logger.info('WebSocket server initialized at /ws');
    return wss;
}

/**
 * Handle a new WebSocket connection.
 *
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} req
 */
function handleConnection(ws, req) {
    // Extract token from URL query string
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
        ws.close(4001, 'Authentication required. Provide ?token=<jwt>');
        return;
    }

    let decoded;
    try {
        decoded = verifyToken(token);
    } catch (err) {
        ws.close(4001, `Authentication failed: ${err.message}`);
        return;
    }

    const { userId, username } = decoded;

    // Register socket
    socketUsers.set(ws, { userId, username });

    if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(ws);

    logger.info({ userId, username }, 'WebSocket client connected');

    // Notify others that user is online
    broadcast('user_online', { userId, username }, null);

    // Send confirmation to the connected user
    ws.send(JSON.stringify({
        type: 'connected',
        payload: { userId, username, message: 'Connected to koshi board' },
    }));

    // Handle incoming messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, message, { userId, username });
        } catch (err) {
            logger.warn({ err }, 'Invalid WebSocket message received');
            ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Invalid message format. Send JSON.' },
            }));
        }
    });

    // Handle disconnection
    ws.on('close', () => {
        const user = socketUsers.get(ws);
        if (user) {
            const sockets = userSockets.get(user.userId);
            if (sockets) {
                sockets.delete(ws);
                if (sockets.size === 0) {
                    userSockets.delete(user.userId);
                    // Notify others that user went offline
                    broadcast('user_offline', { userId: user.userId }, null);
                }
            }
            socketUsers.delete(ws);
            logger.info({ userId: user.userId }, 'WebSocket client disconnected');
        }
    });

    // Handle errors
    ws.on('error', (err) => {
        logger.error({ err }, 'WebSocket error');
        ws.close(1011, 'Internal server error');
    });

    // Heartbeat / ping-pong to detect stale connections
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
}

/**
 * Start a heartbeat interval to detect and clean up stale connections.
 * Runs every 30 seconds.
 */
export function startHeartbeat() {
    if (!wss) return;

    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                socketUsers.delete(ws);
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => {
        clearInterval(interval);
    });
}

/**
 * Broadcast an event to connected clients.
 *
 * @param {string} event - Event name (e.g., 'post_created', 'dm_received')
 * @param {object} payload - Event data
 * @param {string|null} [targetUserId] - If set, send only to that user's sockets
 */
export function broadcast(event, payload, targetUserId = null) {
    if (!wss) return;

    const message = JSON.stringify({ type: event, payload });

    if (targetUserId) {
        // Targeted delivery (e.g., DMs to specific recipient)
        const sockets = userSockets.get(targetUserId);
        if (sockets) {
            sockets.forEach((ws) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(message);
                }
            });
        }
    } else {
        // Broadcast to all connected clients
        wss.clients.forEach((ws) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(message);
            }
        });
    }
}

/**
 * Get the broadcast function for use in API routes.
 * Avoids circular dependency issues.
 *
 * @returns {Function|null}
 */
export function getBroadcast() {
    if (!wss) return null;
    return broadcast;
}

/**
 * Get the count of online users.
 *
 * @returns {number}
 */
export function getOnlineCount() {
    return userSockets.size;
}

/**
 * Get the list of online user IDs.
 *
 * @returns {string[]}
 */
export function getOnlineUsers() {
    return Array.from(userSockets.keys());
}
