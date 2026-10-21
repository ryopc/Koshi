// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Push Token Service
// License: MIT
// ============================================================================
// Handles registration, retrieval, and deletion of Expo push tokens.
// ============================================================================

import { query } from '../db/pool.js';
import { logger } from '../logger.js';

/**
 * Expo push token format.
 * Expo issues tokens as `ExponentPushToken[<payload>]` where the payload is
 * a 20-character opaque string. We accept a conservative subset: the exact
 * `ExponentPushToken[` prefix, a `]` suffix, and a payload of at least 8
 * characters drawn from the URL-safe alphabet.
 */
const EXPO_PUSH_TOKEN_PATTERN = /^ExponentPushToken\[[A-Za-z0-9_-]{8,}\]$/;

/**
 * Validates an Expo push token format.
 *
 * @param {string} token - The token to validate
 * @returns {boolean} - True if valid format
 */
export function isValidExpoPushToken(token) {
    if (typeof token !== 'string') return false;
    return EXPO_PUSH_TOKEN_PATTERN.test(token);
}

/**
 * Register or update a push token for the current user.
 * Uses upsert (INSERT ... ON CONFLICT) to handle both new registration and updates.
 *
 * @param {string} userId - The authenticated user's ID
 * @param {string} expoPushToken - The Expo push token
 * @param {string} [deviceId] - Optional device identifier
 * @param {string} [platform] - Optional platform ('ios' | 'android')
 * @returns {Promise<Object>} - The created/updated token record
 */
export async function registerPushToken(userId, expoPushToken, deviceId, platform) {
    // Validate token format
    if (!isValidExpoPushToken(expoPushToken)) {
        throw new Error('Invalid Expo push token format');
    }

    // Validate platform if provided
    if (platform && !['ios', 'android'].includes(platform)) {
        throw new Error('Platform must be either "ios" or "android"');
    }

    const result = await query(
        `INSERT INTO push_tokens (user_id, expo_push_token, device_id, platform)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, expo_push_token) DO UPDATE SET
             device_id = COALESCE(EXCLUDED.device_id, push_tokens.device_id),
             platform = COALESCE(EXCLUDED.platform, push_tokens.platform),
             updated_at = NOW()
         RETURNING id, user_id, expo_push_token, device_id, platform, created_at, updated_at`,
        [userId, expoPushToken, deviceId || null, platform || null]
    );

    logger.info({ userId, tokenId: result.rows[0].id }, 'Push token registered/updated');
    return result.rows[0];
}

/**
 * Get all push tokens for a user.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<Array>} - Array of push token records
 */
export async function getUserPushTokens(userId) {
    const result = await query(
        `SELECT id, user_id, expo_push_token, device_id, platform, created_at, updated_at
         FROM push_tokens
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
    );
    return result.rows;
}

/**
 * Get push tokens for a user (for sending notifications).
 * Returns only the expo_push_token strings.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<string[]>} - Array of Expo push tokens
 */
export async function getUserPushTokenStrings(userId) {
    const result = await query(
        `SELECT expo_push_token FROM push_tokens WHERE user_id = $1`,
        [userId]
    );
    return result.rows.map(row => row.expo_push_token);
}

/**
 * Delete a push token for the current user.
 * Only allows deletion of tokens belonging to the authenticated user.
 *
 * @param {string} userId - The authenticated user's ID
 * @param {string} expoPushToken - The Expo push token to delete
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
export async function deletePushToken(userId, expoPushToken) {
    const result = await query(
        `DELETE FROM push_tokens
         WHERE user_id = $1 AND expo_push_token = $2
         RETURNING id`,
        [userId, expoPushToken]
    );

    const deleted = result.rows.length > 0;
    if (deleted) {
        logger.info({ userId, tokenId: result.rows[0].id }, 'Push token deleted');
    }
    return deleted;
}

/**
 * Delete all push tokens for a user (e.g., on logout from all devices).
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<number>} - Number of deleted tokens
 */
export async function deleteAllUserPushTokens(userId) {
    const result = await query(
        `DELETE FROM push_tokens WHERE user_id = $1`,
        [userId]
    );
    const count = result.rowCount;
    if (count > 0) {
        logger.info({ userId, count }, 'All push tokens deleted for user');
    }
    return count;
}

export default {
    isValidExpoPushToken,
    registerPushToken,
    getUserPushTokens,
    getUserPushTokenStrings,
    deletePushToken,
    deleteAllUserPushTokens,
};