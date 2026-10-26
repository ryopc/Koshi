// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Authentication Middleware
// License: MIT
// ============================================================================
// Supports both JWT (human users) and API Keys (AI agents).
// API Keys: format "ak_live_..." with SHA-256 hash stored in DB.
// ============================================================================

import { query } from '../db/pool.js';
import { verifyToken } from '../auth/jwt.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createPgKeyStore } from '../agent/keyStore.pg.js';
import { createSqliteKeyStore } from '../agent/keyStore.sqlite.js';
import { createProblem, unauthenticated, invalidApiKey, apiKeyRevoked, apiKeyExpired, forbidden, insufficientScope } from './errors.js';

const API_KEY_PREFIX = 'ak_live_';

function getKeyStore() {
    if (process.env.DATABASE_URL) {
        return createPgKeyStore();
    }
    return createSqliteKeyStore();
}

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

async function verifyApiKey(rawKey) {
    const keyStore = getKeyStore();
    const stored = await keyStore.verify(rawKey);

    if (!stored) {
        return null;
    }

    // Touch last_used_at (throttled in store)
    await keyStore.touchLastUsed(stored.id);

    return {
        userId: stored.agentId,
        username: null, // Will be fetched if needed
        isAgent: true,
        agent: {
            id: stored.agentId,
            scopes: stored.scopes,
            tier: stored.tier
        }
    };
}

/**
 * Express middleware that requires a valid JWT Bearer token OR API Key.
 *
 * Header format: Authorization: Bearer <token>
 *
 * On success, sets req.user = { userId, username, isAgent?, agent? }
 * On failure, responds with 401 and an error message.
 */
export async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return unauthenticated(res, undefined, req.path);
        }

        // Expect format: "Bearer <token>"
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return unauthenticated(res, 'Invalid authorization header format. Use: Authorization: Bearer <token>', req.path);
        }

        const token = parts[1];

        // API Key detection
        if (token.startsWith(API_KEY_PREFIX)) {
            const agent = await verifyApiKey(token);
            if (!agent) {
                return invalidApiKey(res, undefined, req.path);
            }

            // Fetch username for the agent
            const { query } = await import('../db/pool.js');
            const userResult = await query('SELECT username FROM users WHERE id = $1', [agent.userId]);
            if (userResult.rows.length > 0) {
                agent.username = userResult.rows[0].username;
            }

            req.user = agent;
            return next();
        }

        // JWT token
        const decoded = verifyToken(token);

        // A refresh token must never be usable as an access token.
        if (decoded.type === 'refresh') {
            return unauthenticated(res, 'A refresh token cannot be used to authorize requests.', req.path);
        }

        // Attach user info to request object
        req.user = {
            userId: decoded.userId,
            username: decoded.username,
            isAgent: false
        };

        next();
    } catch (err) {
        if (err.message?.includes('API key')) {
            return invalidApiKey(res, err.message, req.path);
        }
        return unauthenticated(res, err.message, req.path);
    }
}

/**
 * Optional auth middleware — attaches user if token is present,
 * but doesn't reject if missing. Supports both JWT and API Key.
 */
export async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return next();
        }

        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return next();
        }

        const token = parts[1];

        // API Key
        if (token.startsWith(API_KEY_PREFIX)) {
            const agent = await verifyApiKey(token);
            if (agent) {
                const { query } = await import('../db/pool.js');
                const userResult = await query('SELECT username FROM users WHERE id = $1', [agent.userId]);
                if (userResult.rows.length > 0) {
                    agent.username = userResult.rows[0].username;
                }
                req.user = agent;
            }
            return next();
        }

        // JWT
        const decoded = verifyToken(token);
        if (decoded.type === 'refresh') {
            return next();
        }

        req.user = {
            userId: decoded.userId,
            username: decoded.username,
            isAgent: false
        };
    } catch {
        // Token invalid or expired — just proceed without user
    }
    next();
}

/**
 * Middleware to require a specific capability (scope).
 * Only works with API Key authentication (agents).
 */
export function requireCapability(requiredScope) {
    return (req, res, next) => {
        if (!req.user?.isAgent || !req.user.agent?.scopes) {
            return forbidden(res, 'This endpoint requires API key authentication with appropriate scopes', req.path);
        }

        const scopes = req.user.agent.scopes;
        if (!scopes.includes(requiredScope)) {
            return insufficientScope(res, requiredScope, req.path);
        }

        next();
    };
}

/**
 * Admin auth middleware — requires authentication AND admin privileges.
 * Works with both JWT (human admins) and API Keys (with admin:read scope).
 */
export async function requireAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return unauthenticated(res, undefined, req.path);
        }

        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return unauthenticated(res, 'Invalid authorization header format. Use: Authorization: Bearer <token>', req.path);
        }

        const token = parts[1];

        // API Key with admin:read scope
        if (token.startsWith(API_KEY_PREFIX)) {
            const agent = await verifyApiKey(token);
            if (!agent) {
                return invalidApiKey(res, undefined, req.path);
            }

            if (!agent.agent?.scopes?.includes('admin:read')) {
                return forbidden(res, 'Admin privileges required (admin:read scope)', req.path);
            }

            const { query } = await import('../db/pool.js');
            const userResult = await query('SELECT username FROM users WHERE id = $1', [agent.userId]);
            if (userResult.rows.length > 0) {
                agent.username = userResult.rows[0].username;
            }

            req.user = agent;
            return next();
        }

        // JWT token (human admin)
        const decoded = verifyToken(token);

        if (decoded.type === 'refresh') {
            return unauthenticated(res, 'A refresh token cannot be used to authorize requests.', req.path);
        }

        req.user = {
            userId: decoded.userId,
            username: decoded.username,
            isAgent: false
        };

        // Check admin status
        const adminUsername = process.env.ADMIN_USERNAME;
        if (adminUsername && req.user.username === adminUsername.toLowerCase().trim()) {
            next();
            return;
        }

        const result = await query(
            'SELECT is_admin FROM users WHERE id = $1',
            [req.user.userId]
        );

        if (result.rows.length === 0 || !result.rows[0].is_admin) {
            return forbidden(res, 'Admin privileges required.', req.path);
        }

        next();
    } catch (err) {
        if (err.message?.includes('API key')) {
            return invalidApiKey(res, err.message, req.path);
        }
        return unauthenticated(res, err.message, req.path);
    }
}

export { requireAuth as default };