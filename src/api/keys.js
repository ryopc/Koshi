// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Key Bundle API Routes (X3DH)
// License: MIT
// ============================================================================
// Provides X3DH key bundles for initiating E2E sessions.
// Consumes one-time prekeys on use.
//
// v5.0.0: one-time prekeys are stored as a JSONB array of
// `{ id, publicKey }` objects so every prekey keeps a stable id.
// The bundle response keeps the existing `oneTimePreKeys` key (an array of
// base64 strings) and additionally reports the id of the prekey that was
// handed out as `preKeyId`.
// ============================================================================

import { Router } from 'express';
import { getClient } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();

/**
 * Parse the stored one-time prekey list.
 * Accepts both the v5 format (`[{ id, publicKey }]`) and a plain string array.
 *
 * @param {unknown} value - Raw column value
 * @returns {Array<{ id: number, publicKey: string }>}
 */
function parsePreKeys(value) {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(parsed)) return [];

    const out = [];
    parsed.forEach((entry, index) => {
        if (typeof entry === 'string') {
            out.push({ id: index, publicKey: entry });
        } else if (entry && typeof entry === 'object' && typeof entry.publicKey === 'string') {
            const id = Number.isInteger(entry.id) ? entry.id : index;
            out.push({ id, publicKey: entry.publicKey });
        }
    });
    return out;
}

// ============================================================================
// GET /api/keys/bundle/:userId
// ============================================================================
// Get a key bundle for a target user (selects one device, consumes one
// one-time prekey).
// Query: ?deviceId=<optional specific device>
// Returns: { userId, bundle: KeyBundle, deviceId }
//
// 404 { error: 'No prekeys available' } when the target has no unused
// one-time prekey left — the client cannot establish a session without one.
// ============================================================================
router.get('/bundle/:userId', requireAuth, async (req, res) => {
    const client = await getClient();
    let inTransaction = false;

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
        inTransaction = true;

        // Get devices for target user. The requested device is preferred, but
        // we fall back to the most recent one so that a stale deviceId does
        // not break session establishment.
        let deviceQuery = 'SELECT * FROM user_devices WHERE user_id = $1';
        const deviceParams = [targetUserId];

        if (requestedDeviceId) {
            deviceQuery += ' AND id = $2';
            deviceParams.push(requestedDeviceId);
        }

        deviceQuery += ' ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE';

        let deviceResult = await client.query(deviceQuery, deviceParams);

        if (deviceResult.rows.length === 0 && requestedDeviceId) {
            // Requested device does not exist for this user — use the latest one.
            deviceResult = await client.query(
                `SELECT * FROM user_devices WHERE user_id = $1
                 ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
                [targetUserId]
            );
        }

        if (deviceResult.rows.length === 0) {
            await client.query('ROLLBACK');
            inTransaction = false;
            return res.status(404).json({ error: 'No prekeys available' });
        }

        const device = deviceResult.rows[0];
        const preKeys = parsePreKeys(device.one_time_pre_keys);

        if (preKeys.length === 0) {
            await client.query('ROLLBACK');
            inTransaction = false;
            return res.status(404).json({ error: 'No prekeys available' });
        }

        // Consume the first unused prekey so that it is never handed out twice.
        const [consumed, ...remaining] = preKeys;
        await client.query(
            'UPDATE user_devices SET one_time_pre_keys = $1 WHERE id = $2',
            [JSON.stringify(remaining), device.id]
        );

        await client.query('COMMIT');
        inTransaction = false;

        const bundle = {
            identityKey: device.identity_key,
            signedPreKey: device.signed_pre_key,
            preKeySignature: device.pre_key_signature,
            // Existing key name / format (array of base64 strings) is kept.
            oneTimePreKeys: [consumed.publicKey],
            // The id of the prekey that was just handed out.
            preKeyId: consumed.id,
        };

        logger.info({ targetUserId, deviceId: device.id, preKeyId: consumed.id }, 'Key bundle requested');

        return res.json({
            userId: targetUserId,
            deviceId: device.id,
            bundle,
        });
    } catch (err) {
        if (inTransaction) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Transaction already closed.
            }
        }
        logger.error({ err, params: req.params }, 'Failed to get key bundle');
        return res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

export default router;
