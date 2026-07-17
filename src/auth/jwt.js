// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// JWT Authentication Utilities
// License: MIT
// ============================================================================
// Wraps jsonwebtoken for token generation and verification.
// Tokens encode the userId and expire after 24 hours.
// ============================================================================

import jwt from 'jsonwebtoken';

/**
 * Get the JWT secret from environment or use a development fallback.
 * In production (PandaStack), JWT_SECRET is set via environment config.
 *
 * @returns {string}
 */
function getSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        // In local/standalone mode, use a deterministic fallback
        // so tokens work without environment variables.
        return 'koshi-local-dev-secret-koshi-local-dev-secret!';
    }
    return secret;
}

/**
 * Sign a JWT token for the given user.
 *
 * @param {object} payload - Token payload (must include userId)
 * @param {string} payload.userId - The user's UUID
 * @param {string} [payload.username] - Optional username for quick lookup
 * @returns {string} Signed JWT token
 */
export function signToken(payload) {
    const secret = getSecret();
    const token = jwt.sign(
        {
            userId: payload.userId,
            username: payload.username || null,
            iat: Math.floor(Date.now() / 1000),
        },
        secret,
        {
            expiresIn: '24h',       // Tokens expire after 24 hours
            algorithm: 'HS256',     // HMAC with SHA-256
        }
    );
    return token;
}

/**
 * Verify and decode a JWT token.
 *
 * @param {string} token - JWT token string
 * @returns {{ userId: string, username: string|null, iat: number, exp: number }}
 * @throws {Error} If token is invalid, expired, or malformed
 */
export function verifyToken(token) {
    const secret = getSecret();
    try {
        const decoded = jwt.verify(token, secret, {
            algorithms: ['HS256'],
        });
        return {
            userId: decoded.userId,
            username: decoded.username || null,
            iat: decoded.iat,
            exp: decoded.exp,
        };
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            throw new Error('Token has expired. Please log in again.');
        }
        if (err instanceof jwt.JsonWebTokenError) {
            throw new Error('Invalid token. Please log in again.');
        }
        throw err;
    }
}

/**
 * Decode a token without verifying the signature.
 * Useful for extracting the userId from an expired token (e.g., for refresh).
 * NOTE: Do NOT use this for authentication — always use verifyToken().
 *
 * @param {string} token
 * @returns {object|null}
 */
export function decodeToken(token) {
    try {
        return jwt.decode(token);
    } catch {
        return null;
    }
}

export default { signToken, verifyToken, decodeToken };
