// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Rate Limiting Middleware
// License: MIT
// ============================================================================
// Uses express-rate-limit to protect auth endpoints from brute-force attacks.
// Applies stricter limits on login/register and lighter limits on general API.
// ============================================================================

import rateLimit from 'express-rate-limit';

/**
 * Strict rate limiter for authentication endpoints.
 * 10 requests per minute per IP — prevents brute-force attacks.
 */
export const authLimiter = rateLimit({
    windowMs: 60 * 1000,            // 1 minute window
    max: 10,                         // 10 requests per window per IP
    standardHeaders: true,           // Return rate limit info in headers
    legacyHeaders: false,            // Disable X-RateLimit-* headers
    message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please wait before trying again.',
    },
});

/**
 * General API rate limiter.
 * 100 requests per minute per IP — sufficient for CLI clients.
 */
export const apiLimiter = rateLimit({
    windowMs: 60 * 1000,            // 1 minute window
    max: 100,                        // 100 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many requests',
        message: 'API rate limit exceeded. Please slow down.',
    },
});

/**
 * Strict rate limiter for post creation (anti-spam).
 * 10 posts per minute per user.
 */
export const postLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many posts',
        message: 'Post rate limit exceeded (max 10 per minute).',
    },
});

/**
 * Rate limiter for push notification token endpoints.
 * Configurable via environment variables:
 *   PUSH_RATE_LIMIT_MAX    - max requests per window (default: 10)
 *   PUSH_RATE_LIMIT_WINDOW - window size in seconds (default: 60)
 */
export const pushLimiter = rateLimit({
    windowMs: (parseInt(process.env.PUSH_RATE_LIMIT_WINDOW, 10) || 60) * 1000,
    max: parseInt(process.env.PUSH_RATE_LIMIT_MAX, 10) || 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many requests',
        message: 'Push token rate limit exceeded. Please wait before trying again.',
    },
});

export default { authLimiter, apiLimiter, postLimiter, pushLimiter };
