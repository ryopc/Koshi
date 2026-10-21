// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Notification Service (Expo Push API)
// License: MIT
// ============================================================================
// Sends push notifications via Expo's Push API.
// https://docs.expo.dev/push-notifications/sending-notifications/
// ============================================================================

import { logger } from '../logger.js';
import { isValidExpoPushToken, getUserPushTokenStrings } from './pushToken.service.js';

// Expo Push API endpoint
const EXPO_PUSH_API_URL = process.env.EXPO_PUSH_API_URL || 'https://exp.host/--/api/v2/push/send';

/**
 * Send push notifications to multiple Expo push tokens.
 * Batches requests to Expo API (max 100 tokens per request recommended).
 *
 * @param {string[]} tokens - Array of Expo push tokens
 * @param {Object} notification - Notification payload
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {Object} [notification.data] - Custom data payload
 * @param {string} [notification.sound='default'] - Sound to play
 * @param {string} [notification.priority='high'] - Priority ('default' | 'normal' | 'high')
 * @param {number} [notification.ttl] - Time to live in seconds
 * @param {number} [notification.expiration] - Expiration timestamp (Unix epoch)
 * @returns {Promise<Object>} - Result with success count, failures, and details
 */
export async function sendPushNotifications(tokens, notification) {
    if (!tokens || tokens.length === 0) {
        return { success: 0, failed: 0, details: [], message: 'No tokens provided' };
    }

    // Filter valid tokens (same rules as the registration endpoint)
    const validTokens = tokens.filter(token => isValidExpoPushToken(token));

    if (validTokens.length === 0) {
        return { success: 0, failed: tokens.length, details: [], message: 'No valid tokens' };
    }

    const results = {
        success: 0,
        failed: 0,
        details: [],
    };

    // Expo recommends max 100 tokens per request
    const BATCH_SIZE = 100;
    const batches = [];

    for (let i = 0; i < validTokens.length; i += BATCH_SIZE) {
        batches.push(validTokens.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
        const messages = batch.map(token => ({
            to: token,
            title: notification.title,
            body: notification.body,
            data: notification.data || {},
            sound: notification.sound || 'default',
            priority: notification.priority || 'high',
            ttl: notification.ttl,
            expiration: notification.expiration,
        }));

        try {
            const response = await fetch(EXPO_PUSH_API_URL, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Accept-encoding': 'gzip, deflate',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(messages),
            });

            const data = await response.json();

            if (data.data) {
                // Process each ticket/receipt
                for (let i = 0; i < data.data.length; i++) {
                    const ticket = data.data[i];
                    const token = batch[i];

                    if (ticket.status === 'ok') {
                        results.success++;
                        results.details.push({ token, status: 'ok', id: ticket.id });
                    } else {
                        results.failed++;
                        results.details.push({
                            token,
                            status: 'error',
                            error: ticket.message,
                            details: ticket.details,
                        });

                        // Log specific error for debugging
                        logger.warn({
                            token: token.substring(0, 20) + '...',
                            error: ticket.message,
                            details: ticket.details,
                        }, 'Expo push notification failed for token');

                        // Handle specific error cases
                        if (ticket.details?.error === 'DeviceNotRegistered') {
                            // Token is no longer valid - could trigger cleanup
                            logger.info({ token: token.substring(0, 20) + '...' }, 'Device not registered, token should be removed');
                        }
                    }
                }
            } else if (data.errors) {
                // Request-level errors
                results.failed += batch.length;
                batch.forEach(token => {
                    results.details.push({
                        token,
                        status: 'error',
                        error: data.errors.map(e => e.message).join(', '),
                    });
                });
                logger.error({ errors: data.errors }, 'Expo push API request failed');
            } else {
                // Unexpected response format
                results.failed += batch.length;
                batch.forEach(token => {
                    results.details.push({
                        token,
                        status: 'error',
                        error: 'Unexpected response format from Expo',
                    });
                });
                logger.error({ response: data }, 'Unexpected Expo push API response');
            }
        } catch (err) {
            results.failed += batch.length;
            batch.forEach(token => {
                results.details.push({
                    token,
                    status: 'error',
                    error: err.message,
                });
            });
            logger.error({ err, batchSize: batch.length }, 'Failed to send push notifications batch');
        }
    }

    logger.info({
        total: validTokens.length,
        success: results.success,
        failed: results.failed,
    }, 'Push notifications sent');

    return results;
}

/**
 * Send a DM notification to a user's devices.
 *
 * @param {string} userId - Recipient user ID
 * @param {Object} sender - Sender info { id, username, displayName }
 * @param {string} content - Message content (will be truncated)
 * @param {string} messageId - DM message ID
 * @returns {Promise<Object>} - Send result
 */
export async function sendDMNotification(userId, sender, content, messageId) {
    const tokens = await getUserPushTokenStrings(userId);

    if (tokens.length === 0) {
        logger.debug({ userId }, 'No push tokens for user, skipping DM notification');
        return { success: 0, failed: 0, details: [], message: 'No push tokens registered' };
    }

    // Truncate content for notification preview
    const truncatedContent = content.length > 100
        ? content.substring(0, 97) + '...'
        : content;

    const displayName = sender.displayName || sender.username;

    const notification = {
        title: '新しいメッセージ',
        body: `@${sender.username}: ${truncatedContent}`,
        data: {
            type: 'dm',
            conversationId: sender.id,
            messageId: messageId,
            senderUsername: sender.username,
            senderDisplayName: displayName,
        },
        sound: 'default',
        priority: 'high',
    };

    return sendPushNotifications(tokens, notification);
}

/**
 * Send a generic notification to a user's devices.
 *
 * @param {string} userId - Recipient user ID
 * @param {Object} notification - Notification payload
 * @returns {Promise<Object>} - Send result
 */
export async function sendNotificationToUser(userId, notification) {
    const tokens = await getUserPushTokenStrings(userId);

    if (tokens.length === 0) {
        return { success: 0, failed: 0, details: [], message: 'No push tokens registered' };
    }

    return sendPushNotifications(tokens, notification);
}

export default {
    sendPushNotifications,
    sendDMNotification,
    sendNotificationToUser,
};