// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Key Bundle API Routes (X3DH)
// License: MIT
// ============================================================================
// Provides X3DH key bundles for initiating E2E sessions.
// Consumes one-time prekeys on use.
// ============================================================================

import { Router } from 'express';
import { query, getClient } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// GET /api/keys/bundle/:userId
// ============================================================================
// Get a key bundle for a target user (selects one device, consumes one one-time prekey).
// Query: ?deviceId=<optional specific device>
// Returns: { userId, bundle: KeyBundle, deviceId }
// ============================================================================
router.get('/bundle/:userId', requireAuth, async (req, res) => {
    const client = await getClient();
    try {
        const currentUserId = req.user.userId;
        const targetUserId = req.params.userId;
        const requestedDeviceId = req.query.deviceId;

        if (currentUserId === targetUserId) {
            return res.status(400).json({ error: 'Cannot request key bundle for yourself.' });
        }

        // Verify target user exists
        const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [targetUserId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Target user not found.' });
        }

        await client.query('BEGIN');

        // Get devices for target user
        let deviceQuery = 'SELECT * FROM user_devices WHERE user_id = $1';
        const deviceParams = [targetUserId];

        if (requestedDeviceId) {
            deviceQuery += ' AND id = $2';
            deviceParams.push(requestedDeviceId);
        }

        deviceQuery += ' ORDER BY created_at DESC LIMIT 1';

        const deviceResult = await client.query(deviceQuery, deviceParams);
        if (deviceResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'No devices found for target user.' });
        }

        const device = deviceResult.rows[0];
        const oneTimePreKeys = device.one_time_pre_keys || [];

        // Consume one one-time prekey (remove it from the array)
        let consumedPreKey = null;
        let updatedPreKeys = [...oneTimePreKeys];

        if (updatedPreKeys.length > 0) {
            consumedPreKey = updatedPreKeys.shift(); // Take the first one
            await client.query(
                'UPDATE user_devices SET one_time_pre_keys = $1 WHERE id = $2',
                [updatedPreKeys, device.id]
            );
        }

        await client.query('COMMIT');

        const bundle = {
            identityKey: device.identity_key,
            signedPreKey: device.signed_pre_key,
            preKeySignature: device.pre_key_signature,
            oneTimePreKeys: consumedPreKey ? [consumedPreKey] : [],
        };

        logger.info({ targetUserId, deviceId: device.id, consumedPreKey: !!consumedPreKey }, 'Key bundle requested');

        return res.json({
            userId: targetUserId,
            deviceId: device.id,
            bundle,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err, params: req.params }, 'Failed to get key bundle');
        return res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

export default router;