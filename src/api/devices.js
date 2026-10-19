// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Device Management API Routes
// License: MIT
// ============================================================================
// Handles X3DH device registration and key management for E2E encryption.
// ============================================================================

import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// GET /api/devices
// ============================================================================
// List authenticated user's registered devices.
// Returns: [Device]
// ============================================================================
router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await query(
            `SELECT id, user_id, device_name, identity_key, signed_pre_key,
                    pre_key_signature, one_time_pre_keys, created_at, last_seen_at
             FROM user_devices
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );

        const devices = result.rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            deviceName: row.device_name,
            identityKey: row.identity_key,
            signedPreKey: row.signed_pre_key,
            preKeySignature: row.pre_key_signature,
            oneTimePreKeys: row.one_time_pre_keys,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
        }));

        return res.json(devices);
    } catch (err) {
        logger.error({ err }, 'Failed to fetch devices');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// POST /api/devices
// ============================================================================
// Register a new device for the authenticated user.
// Body: { deviceName?, identityKey, signedPreKey, preKeySignature, oneTimePreKeys: string[] }
// Returns: { device }
// ============================================================================
router.post('/', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { deviceName, identityKey, signedPreKey, preKeySignature, oneTimePreKeys } = req.body;

        // Validation
        if (!identityKey || typeof identityKey !== 'string') {
            return res.status(400).json({ error: 'identityKey is required (base64 X25519 public key).' });
        }
        if (!signedPreKey || typeof signedPreKey !== 'string') {
            return res.status(400).json({ error: 'signedPreKey is required (base64 X25519 public key).' });
        }
        if (!preKeySignature || typeof preKeySignature !== 'string') {
            return res.status(400).json({ error: 'preKeySignature is required (base64 ed25519 signature of signedPreKey).' });
        }
        if (!Array.isArray(oneTimePreKeys) || oneTimePreKeys.length === 0) {
            return res.status(400).json({ error: 'oneTimePreKeys array is required (at least 1 base64 X25519 public key).' });
        }
        if (oneTimePreKeys.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 one-time prekeys allowed.' });
        }
        if (deviceName && (typeof deviceName !== 'string' || deviceName.length > 64)) {
            return res.status(400).json({ error: 'Device name too long (max 64 chars).' });
        }

        // Validate base64 format (basic check)
        const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
        if (!base64Regex.test(identityKey) || !base64Regex.test(signedPreKey) || !base64Regex.test(preKeySignature)) {
            return res.status(400).json({ error: 'Keys must be valid base64 strings.' });
        }
        for (const key of oneTimePreKeys) {
            if (!base64Regex.test(key)) {
                return res.status(400).json({ error: 'All one-time prekeys must be valid base64 strings.' });
            }
        }

        const result = await query(
            `INSERT INTO user_devices (user_id, device_name, identity_key, signed_pre_key, pre_key_signature, one_time_pre_keys)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, user_id, device_name, identity_key, signed_pre_key, pre_key_signature, one_time_pre_keys, created_at, last_seen_at`,
            [userId, deviceName?.trim() || null, identityKey, signedPreKey, preKeySignature, oneTimePreKeys]
        );

        const device = result.rows[0];
        logger.info({ userId, deviceId: device.id }, 'Device registered');

        return res.status(201).json({
            id: device.id,
            userId: device.user_id,
            deviceName: device.device_name,
            identityKey: device.identity_key,
            signedPreKey: device.signed_pre_key,
            preKeySignature: device.pre_key_signature,
            oneTimePreKeys: device.one_time_pre_keys,
            createdAt: device.created_at,
            lastSeenAt: device.last_seen_at,
        });
    } catch (err) {
        logger.error({ err }, 'Failed to register device');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// DELETE /api/devices/:deviceId
// ============================================================================
// Delete a device (only owner can delete).
// Returns: { success: boolean }
// ============================================================================
router.delete('/:deviceId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const deviceId = req.params.deviceId;

        const result = await query(
            'DELETE FROM user_devices WHERE id = $1 AND user_id = $2 RETURNING id',
            [deviceId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found.' });
        }

        logger.info({ userId, deviceId }, 'Device deleted');
        return res.json({ success: true });
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to delete device');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================================
// GET /api/devices/user/:userId
// ============================================================================
// Get another user's device list (public keys only, for key agreement).
// Returns: [Device] (without sensitive fields like preKeySignature?)
// Actually we need all fields for X3DH key agreement.
// ============================================================================
router.get('/user/:userId', requireAuth, async (req, res) => {
    try {
        const targetUserId = req.params.userId;

        // Verify target user exists
        const userCheck = await query('SELECT id FROM users WHERE id = $1', [targetUserId]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const result = await query(
            `SELECT id, user_id, device_name, identity_key, signed_pre_key,
                    pre_key_signature, one_time_pre_keys, created_at, last_seen_at
             FROM user_devices
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [targetUserId]
        );

        const devices = result.rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            deviceName: row.device_name,
            identityKey: row.identity_key,
            signedPreKey: row.signed_pre_key,
            preKeySignature: row.pre_key_signature,
            oneTimePreKeys: row.one_time_pre_keys,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
        }));

        return res.json(devices);
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch user devices');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;