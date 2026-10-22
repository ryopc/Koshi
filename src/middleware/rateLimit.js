// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Rate Limiting Middleware
// License: MIT
// ============================================================================
// Supports tier-based rate limiting for agents (free/standard/trusted)
// and IP-based limiting for unauthenticated/human users.
// ============================================================================

import rateLimit from 'express-rate-limit';

/**
 * Base rate limit configuration.
 */
const BASE_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Agent tier multipliers (from capabilities.js)
 * free: 1x (base), standard: 2x, trusted: 5x
 */
const TIER_MULTIPLIERS = {
    free: 1,
    standard: 2,
    trusted: 5
};

/**
 * Default base limits (for free tier / unauthenticated / human users).
 * These are per-minute limits.
 */
const DEFAULT_LIMITS = {
    auth: 10,      // auth endpoints
    api: 100,      // general API
    post: 10,      // post creation
    push: 10       // push token endpoints
};

/**
 * Create a rate limiter with tier-aware limits.
 * For API key authenticated requests, uses the agent's tier multiplier.
 * For JWT/unauthenticated, uses free tier (1x) limits.
 */
function createTieredLimiter(baseMax, message) {
    return rateLimit({
        windowMs: BASE_WINDOW_MS,
        max: (req, res) => {
            // Default to free tier (1x)
            let multiplier = TIER_MULTIPLIERS.free;

            // If authenticated via API key, use agent's tier
            if (req.user?.isAgent && req.user.agent?.tier) {
                multiplier = TIER_MULTIPLIERS[req.user.agent.tier] || TIER_MULTIPLIERS.free;
            }

            return baseMax * multiplier;
        },
        standardHeaders: true,
        legacyHeaders: false,
        message: message || {
            error: 'Too many requests',
            message: 'Rate limit exceeded. Please slow down.',
        },
        // Use agent ID + tier for key when available, otherwise IP
        keyGenerator: (req) => {
            if (req.user?.isAgent) {
                return `agent:${req.user.userId}:${req.user.agent.tier}`;
            }
            if (req.user?.userId) {
                return `user:${req.user.userId}`;
            }
            return req.ip;
        }
    });
}

/**
 * Strict rate limiter for authentication endpoints.
 * 10 requests per minute per IP (free tier) — prevents brute-force attacks.
 * Agent tier multipliers apply: standard=20, trusted=50.
 */
export const authLimiter = createTieredLimiter(DEFAULT_LIMITS.auth, {
    error: 'Too many requests',
    message: 'Auth rate limit exceeded. Please wait before trying again.',
});

/**
 * General API rate limiter.
 * 100 requests per minute per IP (free tier) — sufficient for CLI clients.
 * Agent tier multipliers: standard=200, trusted=500.
 */
export const apiLimiter = createTieredLimiter(DEFAULT_LIMITS.api, {
    error: 'Too many requests',
    message: 'API rate limit exceeded. Please slow down.',
});

/**
 * Strict rate limiter for post creation (anti-spam).
 * 10 posts per minute per user (free tier).
 * Agent tier multipliers: standard=20, trusted=50.
 */
export const postLimiter = createTieredLimiter(DEFAULT_LIMITS.post, {
    error: 'Too many posts',
    message: 'Post rate limit exceeded. Please slow down.',
});

/**
 * Rate limiter for push notification token endpoints.
 * Configurable via environment variables:
 *   PUSH_RATE_LIMIT_MAX    - max requests per window (default: 10)
 *   PUSH_RATE_LIMIT_WINDOW - window size in seconds (default: 60)
 * Agent tier multipliers apply.
 */
export const pushLimiter = createTieredLimiter(
    parseInt(process.env.PUSH_RATE_LIMIT_MAX, 10) || DEFAULT_LIMITS.push,
    {
        error: 'Too many requests',
        message: 'Push token rate limit exceeded. Please wait before trying again.',
    }
);

/**
 * Agent-specific limiter for endpoints that need stricter control.
 * Uses the same tier multipliers.
 */
export function createAgentLimiter(baseMax, options) {
    return createTieredLimiter(baseMax, options.message);
}

export default { authLimiter, apiLimiter, postLimiter, pushLimiter, createAgentLimiter };