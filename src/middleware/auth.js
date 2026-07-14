// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Authentication Middleware
// License: MIT
// ============================================================================
// Extracts and verifies the JWT token from the Authorization header.
// Attaches the decoded user payload to req.user for downstream handlers.
// ============================================================================

import { query } from '../db/pool.js';
import { verifyToken } from '../auth/jwt.js';

/**
 * Express middleware that requires a valid JWT Bearer token.
 *
 * Header format: Authorization: Bearer <token>
 *
 * On success, sets req.user = { userId, username, iat, exp }
 * On failure, responds with 401 and an error message.
 */
export function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Please provide a valid JWT token in the Authorization header.',
            });
        }

        // Expect format: "Bearer <token>"
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return res.status(401).json({
                error: 'Invalid authorization header format',
                message: 'Use: Authorization: Bearer <token>',
            });
        }

        const token = parts[1];
        const decoded = verifyToken(token);

        // Attach user info to request object
        req.user = {
            userId: decoded.userId,
            username: decoded.username,
        };

        next();
    } catch (err) {
        return res.status(401).json({
            error: 'Authentication failed',
            message: err.message,
        });
    }
}

/**
 * Optional auth middleware — attaches user if token is present,
 * but doesn't reject if missing. Useful for public endpoints that
 * optionally personalize content.
 */
export function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const parts = authHeader.split(' ');
            if (parts.length === 2 && parts[0] === 'Bearer') {
                const decoded = verifyToken(parts[1]);
                req.user = {
                    userId: decoded.userId,
                    username: decoded.username,
                };
            }
        }
    } catch {
        // Token invalid or expired — just proceed without user
    }
    next();
}

/**
 * Admin auth middleware — requires authentication AND admin privileges.
 * Checks the `is_admin` flag on the user record in the database.
 * Also respects the ADMIN_USERNAME env var for bootstrapping.
 */
export async function requireAdmin(req, res, next) {
    try {
        // First, require authentication
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Please provide a valid JWT token in the Authorization header.',
            });
        }

        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return res.status(401).json({
                error: 'Invalid authorization header format',
                message: 'Use: Authorization: Bearer <token>',
            });
        }

        const token = parts[1];
        const decoded = verifyToken(token);

        req.user = {
            userId: decoded.userId,
            username: decoded.username,
        };

        // Check admin status
        // 1. If ADMIN_USERNAME env var is set and matches, grant admin
        const adminUsername = process.env.ADMIN_USERNAME;
        if (adminUsername && req.user.username === adminUsername.toLowerCase().trim()) {
            next();
            return;
        }

        // 2. Check is_admin flag in database
        const result = await query(
            'SELECT is_admin FROM users WHERE id = $1',
            [req.user.userId]
        );

        if (result.rows.length === 0 || !result.rows[0].is_admin) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Admin privileges required.',
            });
        }

        next();
    } catch (err) {
        return res.status(401).json({
            error: 'Authentication failed',
            message: err.message,
        });
    }
}

export { requireAuth as default };

