// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// RFC 9457 Problem Details Error Helpers
// License: MIT
// ============================================================================
// Provides a standardized way to return machine-readable error responses.
// Existing keys {error, message} are preserved for backward compatibility.
// ============================================================================

import { STATUS_CODES } from 'node:http';
import { logger } from '../logger.js';

/**
 * Well-known problem types (URN format).
 * Extend as needed.
 */
export const ProblemType = {
    // Generic
    ABOUT_BLANK: 'about:blank',

    // Authentication / Authorization
    UNAUTHENTICATED: 'https://koshi.ryopc.org/problems/unauthenticated',
    INVALID_TOKEN: 'https://koshi.ryopc.org/problems/invalid-token',
    TOKEN_EXPIRED: 'https://koshi.ryopc.org/problems/token-expired',
    INSUFFICIENT_SCOPE: 'https://koshi.ryopc.org/problems/insufficient-scope',
    INVALID_API_KEY: 'https://koshi.ryopc.org/problems/invalid-api-key',
    API_KEY_REVOKED: 'https://koshi.ryopc.org/problems/api-key-revoked',
    API_KEY_EXPIRED: 'https://koshi.ryopc.org/problems/api-key-expired',
    FORBIDDEN: 'https://koshi.ryopc.org/problems/forbidden',

    // Validation
    INVALID_REQUEST: 'https://koshi.ryopc.org/problems/invalid-request',
    VALIDATION_FAILED: 'https://koshi.ryopc.org/problems/validation-failed',
    MISSING_FIELD: 'https://koshi.ryopc.org/problems/missing-field',
    INVALID_FIELD: 'https://koshi.ryopc.org/problems/invalid-field',

    // Resource
    NOT_FOUND: 'https://koshi.ryopc.org/problems/not-found',
    CONFLICT: 'https://koshi.ryopc.org/problems/conflict',
    GONE: 'https://koshi.ryopc.org/problems/gone',

    // Rate limiting
    RATE_LIMITED: 'https://koshi.ryopc.org/problems/rate-limited',
    QUOTA_EXCEEDED: 'https://koshi.ryopc.org/problems/quota-exceeded',

    // Server
    INTERNAL_ERROR: 'https://koshi.ryopc.org/problems/internal-error',
    SERVICE_UNAVAILABLE: 'https://koshi.ryopc.org/problems/service-unavailable',
    DEPENDENCY_FAILED: 'https://koshi.ryopc.org/problems/dependency-failed',
};

/**
 * Create a Problem Details object (RFC 9457).
 * Also includes legacy {error, message} keys for backward compatibility.
 *
 * @param {Object} opts
 * @param {string} opts.type - Problem type URI
 * @param {string} opts.title - Short human-readable title
 * @param {number} opts.status - HTTP status code
 * @param {string} [opts.detail] - Human-readable explanation
 * @param {string} [opts.instance] - Request-specific URI (e.g., request path)
 * @param {Object} [opts.extensions] - Additional members
 * @returns {Object} Problem Details object
 */
export function createProblem({
    type,
    title,
    status,
    detail,
    instance,
    extensions = {},
}) {
    const problem = {
        type,
        title,
        status,
        // 既存互換: {error, message} も含める
        error: title,
        message: detail || STATUS_CODES[status] || 'Error',
    };

    if (detail) problem.detail = detail;
    if (instance) problem.instance = instance;

    // 拡張フィールド
    for (const [key, value] of Object.entries(extensions)) {
        if (value !== undefined && value !== null) {
            problem[key] = value;
        }
    }

    return problem;
}

/**
 * Send a Problem Details response.
 * Sets appropriate Content-Type header.
 *
 * @param {import('express').Response} res
 * @param {Object} problem - Result of createProblem()
 * @returns {import('express').Response}
 */
export function sendProblem(res, problem) {
    res.set('Content-Type', 'application/problem+json; charset=utf-8');
    return res.status(problem.status).json(problem);
}

/**
 * Convenience: create and send in one call.
 */
export function problem(res, opts) {
    return sendProblem(res, createProblem(opts));
}

/**
 * Pre-built common errors.
 */

// 400 Bad Request
export function badRequest(res, detail, instance, extensions) {
    return problem(res, {
        type: ProblemType.INVALID_REQUEST,
        title: 'Bad Request',
        status: 400,
        detail,
        instance,
        extensions,
    });
}

export function validationFailed(res, detail, instance, errors) {
    return problem(res, {
        type: ProblemType.VALIDATION_FAILED,
        title: 'Validation Failed',
        status: 400,
        detail,
        instance,
        extensions: { errors },
    });
}

// 401 Unauthorized
export function unauthenticated(res, detail, instance) {
    return problem(res, {
        type: ProblemType.UNAUTHENTICATED,
        title: 'Unauthenticated',
        status: 401,
        detail: detail || 'Authentication required. Provide a valid JWT or API key.',
        instance,
    });
}

export function invalidToken(res, detail, instance) {
    return problem(res, {
        type: ProblemType.INVALID_TOKEN,
        title: 'Invalid Token',
        status: 401,
        detail: detail || 'The provided token is invalid or malformed.',
        instance,
    });
}

export function tokenExpired(res, instance) {
    return problem(res, {
        type: ProblemType.TOKEN_EXPIRED,
        title: 'Token Expired',
        status: 401,
        detail: 'The access token has expired. Use the refresh token to obtain a new one.',
        instance,
    });
}

export function invalidApiKey(res, detail, instance) {
    return problem(res, {
        type: ProblemType.INVALID_API_KEY,
        title: 'Invalid API Key',
        status: 401,
        detail: detail || 'The provided API key is invalid.',
        instance,
    });
}

export function apiKeyRevoked(res, instance) {
    return problem(res, {
        type: ProblemType.API_KEY_REVOKED,
        title: 'API Key Revoked',
        status: 401,
        detail: 'The API key has been revoked.',
        instance,
    });
}

export function apiKeyExpired(res, instance) {
    return problem(res, {
        type: ProblemType.API_KEY_EXPIRED,
        title: 'API Key Expired',
        status: 401,
        detail: 'The API key has expired.',
        instance,
    });
}

// 403 Forbidden
export function forbidden(res, detail, instance) {
    return problem(res, {
        type: ProblemType.FORBIDDEN,
        title: 'Forbidden',
        status: 403,
        detail: detail || 'You do not have permission to perform this action.',
        instance,
    });
}

export function insufficientScope(res, requiredScope, instance) {
    return problem(res, {
        type: ProblemType.INSUFFICIENT_SCOPE,
        title: 'Insufficient Scope',
        status: 403,
        detail: `This action requires the '${requiredScope}' scope.`,
        instance,
        extensions: { requiredScope },
    });
}

// 404 Not Found
export function notFound(res, resource, instance) {
    return problem(res, {
        type: ProblemType.NOT_FOUND,
        title: 'Not Found',
        status: 404,
        detail: resource ? `${resource} not found.` : 'The requested resource was not found.',
        instance,
    });
}

// 409 Conflict
export function conflict(res, detail, instance, extensions) {
    return problem(res, {
        type: ProblemType.CONFLICT,
        title: 'Conflict',
        status: 409,
        detail,
        instance,
        extensions,
    });
}

// 429 Too Many Requests
export function rateLimited(res, detail, retryAfter, instance) {
    if (retryAfter) res.set('Retry-After', String(retryAfter));
    return problem(res, {
        type: ProblemType.RATE_LIMITED,
        title: 'Too Many Requests',
        status: 429,
        detail: detail || 'Rate limit exceeded. Please slow down.',
        instance,
        extensions: retryAfter ? { retryAfter } : undefined,
    });
}

// 500 Internal Server Error
export function internalError(res, detail, instance, err) {
    // エラー詳細はログに出すが、クライアントには最小限のみ返す
    logger.error({ err, instance }, detail || 'Internal server error');
    return problem(res, {
        type: ProblemType.INTERNAL_ERROR,
        title: 'Internal Server Error',
        status: 500,
        detail: detail || 'An unexpected error occurred.',
        instance,
    });
}

export function serviceUnavailable(res, detail, retryAfter, instance) {
    if (retryAfter) res.set('Retry-After', String(retryAfter));
    return problem(res, {
        type: ProblemType.SERVICE_UNAVAILABLE,
        title: 'Service Unavailable',
        status: 503,
        detail: detail || 'The service is temporarily unavailable.',
        instance,
        extensions: retryAfter ? { retryAfter } : undefined,
    });
}

export function dependencyFailed(res, dependency, detail, instance) {
    logger.error({ dependency, instance }, detail || `Dependency ${dependency} failed`);
    return problem(res, {
        type: ProblemType.DEPENDENCY_FAILED,
        title: 'Dependency Failed',
        status: 502,
        detail: detail || `The ${dependency} service is unavailable.`,
        instance,
        extensions: { dependency },
    });
}