// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// JWT Authentication Utilities
// License: MIT
// ============================================================================
// Wraps jsonwebtoken for token generation and verification.
// Tokens encode the userId and expire after 24 hours.
//
// v5.0.0: tokens carry a `type` claim ('access' | 'refresh').
//   - access token : { userId, username, type: 'access', iat, exp }
//   - refresh token: { userId, username, type: 'refresh', iat, exp }
// Tokens without a `type` claim are treated as access tokens, so tokens
// issued before v5.0.0 keep working.
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
 * @param {object} [options] - Signing options
 * @param {string} [options.type] - Token type ('access' | 'refresh').
 *   Omit for access tokens (backward compatible with legacy tokens).
 * @param {string|number} [options.expiresIn] - Lifetime (e.g. '24h', '30d').
 *   Defaults to '24h'.
 * @returns {string} Signed JWT token
 */
export function signToken(payload, options = {}) {
    const secret = getSecret();

    const claims = {
        userId: payload.userId,
        username: payload.username || null,
        iat: Math.floor(Date.now() / 1000),
    };
    if (options.type) claims.type = options.type;
    // A unique id makes every token distinct. Without it two tokens issued
    // for the same user within the same second would be byte-identical.
    if (payload.jti) claims.jti = payload.jti;

    const token = jwt.sign(claims, secret, {
        expiresIn: options.expiresIn || '24h',   // Tokens expire after 24 hours
        algorithm: 'HS256',                       // HMAC with SHA-256
    });
    return token;
}

/**
 * Verify and decode a JWT token.
 *
 * @param {string} token - JWT token string
 * @returns {{ userId: string, username: string|null, iat: number, exp: number, type: string|undefined }}
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
            type: decoded.type || null,
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
