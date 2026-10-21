// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Authentication API Routes
// License: MIT
// ============================================================================
// Handles user registration and login using ed25519 keypairs.
//
// Register: User provides username + public key. Server stores them.
// Login:    User signs a challenge with their secret key. Server verifies
//           the signature against the stored public key and issues a JWT.
//
// v5.0.0: access tokens and refresh tokens. Refresh tokens are stored as a
// SHA-256 hash so a database leak does not expose usable credentials.
// ============================================================================

import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { signToken, verifyToken } from '../auth/jwt.js';
import { verifySignature } from '../auth/ed25519.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// Token helpers
// ============================================================================
const ACCESS_TOKEN_TTL = '24h';
const REFRESH_TOKEN_TTL = '30d';
const REFRESH_TOKEN_TTL_DAYS = 30;

/**
 * Hash a bearer token for storage. Raw tokens are never written to the DB.
 *
 * @param {string} token
 * @returns {string} hex sha256 digest
 */
function hashToken(token) {
    return createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Issue a refresh token and persist its hash.
 *
 * @param {string} userId
 * @param {string} username
 * @returns {Promise<string>} the raw refresh token (returned to the client once)
 */
async function issueRefreshToken(userId, username) {
    const token = signToken(
        { userId, username, jti: randomUUID() },
        { type: 'refresh', expiresIn: REFRESH_TOKEN_TTL }
    );

    await query(
        `INSERT INTO refresh_tokens (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '${REFRESH_TOKEN_TTL_DAYS} days')`,
        [hashToken(token), userId]
    );

    return token;
}

// ============================================================================
// POST /api/auth/register
// ============================================================================
// Register a new user with an ed25519 public key.
//
// Body: { username: string, publicKey: string }
// The publicKey is the ed25519 public key (hex-encoded, 64 chars).
//
// Returns: { userId: UUID, token: string, refreshToken: string }
// ============================================================================
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { username, publicKey } = req.body;

        // -- Input validation --
        if (!username || typeof username !== 'string') {
            return res.status(400).json({ error: 'Username is required and must be a string.' });
        }
        if (!publicKey || typeof publicKey !== 'string') {
            return res.status(400).json({ error: 'Public key is required and must be a string.' });
        }

        const trimmedUsername = username.trim().toLowerCase();

        // Validate username format (alphanumeric, 3-32 chars, no special chars)
        if (!/^[a-z0-9_-]{3,32}$/.test(trimmedUsername)) {
            return res.status(400).json({
                error: 'Invalid username format.',
                message: 'Username must be 3-32 characters, alphanumeric with hyphens and underscores.',
            });
        }

        // Validate public key length (32 bytes = 64 hex chars)
        if (!/^[0-9a-f]{64}$/i.test(publicKey)) {
            return res.status(400).json({
                error: 'Invalid public key format.',
                message: 'Public key must be a 64-character hex string (32 bytes).',
            });
        }

        // -- Check for existing user --
        const existing = await query(
            'SELECT id FROM users WHERE username = $1 OR public_key = $2',
            [trimmedUsername, publicKey]
        );

        if (existing.rows.length > 0) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'Username or public key already registered.',
            });
        }

        // -- Create user --
        const result = await query(
            `INSERT INTO users (username, public_key)
             VALUES ($1, $2)
             RETURNING id, username, public_key, created_at`,
            [trimmedUsername, publicKey]
        );

        const user = result.rows[0];

        // -- Generate tokens --
        const token = signToken(
            { userId: user.id, username: user.username },
            { type: 'access', expiresIn: ACCESS_TOKEN_TTL }
        );
        const refreshToken = await issueRefreshToken(user.id, user.username);

        logger.info({ userId: user.id, username: user.username }, 'User registered');

        return res.status(201).json({
            userId: user.id,
            token,
            refreshToken,
        });
    } catch (err) {
        logger.error({ err }, 'Registration failed');
        return res.status(500).json({ error: 'Internal server error', message: 'Could not complete registration.' });
    }
});

// ============================================================================
// POST /api/auth/login
// ============================================================================
// Authenticate a user by verifying an ed25519 signature.
//
// Body: { username: string, signature: string }
// The signature is the hex-encoded ed25519 signature of the challenge string.
//
// Returns: { token: string, userId: UUID, refreshToken: string }
// ============================================================================
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { username, signature } = req.body;

        // -- Input validation --
        if (!username || typeof username !== 'string') {
            return res.status(400).json({ error: 'Username is required and must be a string.' });
        }
        if (!signature || typeof signature !== 'string') {
            return res.status(400).json({ error: 'Signature is required and must be a string.' });
        }

        const trimmedUsername = username.trim().toLowerCase();

        // -- Look up user --
        const result = await query(
            'SELECT id, username, public_key FROM users WHERE username = $1',
            [trimmedUsername]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found', message: 'No account with that username.' });
        }

        const user = result.rows[0];

        // -- Verify signature --
        // The challenge message is: "login:{username}:{timestamp}"
        // We'll use a simple challenge format. In practice, the server
        // would issue a nonce, but for CLI clients this pattern works.
        const challenge = `koshi:login:${user.username}`;
        const isValid = await verifySignature(challenge, signature, user.public_key);

        if (!isValid) {
            return res.status(401).json({ error: 'Authentication failed', message: 'Invalid signature.' });
        }

        // -- Generate tokens --
        const token = signToken(
            { userId: user.id, username: user.username },
            { type: 'access', expiresIn: ACCESS_TOKEN_TTL }
        );
        const refreshToken = await issueRefreshToken(user.id, user.username);

        logger.info({ userId: user.id, username: user.username }, 'User logged in');

        return res.json({
            token,
            userId: user.id,
            refreshToken,
        });
    } catch (err) {
        logger.error({ err }, 'Login failed');
        return res.status(500).json({ error: 'Internal server error', message: 'Could not complete login.' });
    }
});

// ============================================================================
// POST /api/auth/refresh
// ============================================================================
// Exchange a refresh token for a new access token (+ a rotated refresh token).
//
// Body: { refreshToken: string }
// Returns: { token: string, refreshToken: string }
// 401 { error: 'Invalid refresh token' } for anything that is not a live
// refresh token belonging to an existing user.
// ============================================================================
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body || {};

        if (!refreshToken || typeof refreshToken !== 'string') {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // -- The token must be a valid, unexpired refresh token --
        let payload;
        try {
            payload = verifyToken(refreshToken);
        } catch {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        if (payload.type !== 'refresh') {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // -- It must exist, not be revoked, and not be expired --
        const stored = await query(
            `SELECT id, user_id, expires_at, revoked
             FROM refresh_tokens
             WHERE token_hash = $1`,
            [hashToken(refreshToken)]
        );

        if (stored.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        const record = stored.rows[0];
        if (record.revoked) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        if (new Date(record.expires_at).getTime() <= Date.now()) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        if (record.user_id !== payload.userId) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        // -- The user must still exist --
        const userResult = await query(
            'SELECT id, username FROM users WHERE id = $1',
            [record.user_id]
        );
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }
        const user = userResult.rows[0];

        // -- Rotate: revoke the old token, issue a new pair --
        await query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [record.id]);

        const token = signToken(
            { userId: user.id, username: user.username },
            { type: 'access', expiresIn: ACCESS_TOKEN_TTL }
        );
        const newRefreshToken = await issueRefreshToken(user.id, user.username);

        return res.json({
            token,
            refreshToken: newRefreshToken,
        });
    } catch (err) {
        logger.error({ err }, 'Token refresh failed');
        return res.status(500).json({ error: 'Internal server error', message: 'Could not refresh the token.' });
    }
});

// ============================================================================
// POST /api/auth/logout
// ============================================================================
// Revoke refresh tokens. Access tokens are stateless and are not revoked.
//
// Body: { refreshToken?: string }
// Returns: { success: boolean }
// ============================================================================
router.post('/logout', async (req, res) => {
    try {
        const bodyToken = req.body && req.body.refreshToken;

        if (bodyToken && typeof bodyToken === 'string') {
            // Revoke exactly the given refresh token.
            await query(
                'UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1',
                [hashToken(bodyToken)]
            );
            return res.json({ success: true });
        }

        // Fallback: revoke every active refresh token of the authenticated user.
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const decoded = verifyToken(authHeader.slice(7));
                if (decoded.type !== 'refresh') {
                    await query(
                        'UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE',
                        [decoded.userId]
                    );
                }
            } catch {
                // Invalid token — nothing to revoke.
            }
        }

        return res.json({ success: true });
    } catch (err) {
        logger.error({ err }, 'Logout failed');
        return res.status(500).json({ error: 'Internal server error', message: 'Could not complete logout.' });
    }
});

export default router;
