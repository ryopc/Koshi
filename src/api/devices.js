// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Device Management API Routes
// License: MIT
// ============================================================================
// Handles X3DH device registration and key management for E2E encryption.
//
// v5.0.0: one-time prekeys are stored as a JSONB array of `{ id, publicKey }`
// objects. API responses keep exposing `oneTimePreKeys` as a plain array of
// base64 strings, which is the format the clients rely on.
// ============================================================================

import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// Key format helpers
// ============================================================================
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// X25519 public keys are serialized with a 0x05 type byte (33 bytes).
const PUBLIC_KEY_BYTE_LENGTHS = [32, 33];
// XEdDSA signatures are 64 bytes.
const SIGNATURE_BYTE_LENGTHS = [64];

/**
 * Check that a string is base64 AND decodes to one of the given byte lengths.
 * The length check is what actually separates base64 from hex: a 64-char hex
 * string is a valid base64 *alphabet* string but decodes to 48 bytes, not 33.
 *
 * @param {unknown} value
 * @param {number[]} allowedLengths - accepted decoded byte lengths
 * @returns {boolean}
 */
function isBase64OfLength(value, allowedLengths) {
    if (typeof value !== 'string' || !BASE64_RE.test(value)) return false;

    let decoded;
    try {
        decoded = Buffer.from(value, 'base64');
    } catch {
        return false;
    }

    // Reject input that is not canonical base64 (Node's decoder is lenient).
    if (decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) return false;

    return allowedLengths.includes(decoded.length);
}

/**
 * Parse the stored one-time prekey list.
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

/**
 * Format a device row for the API.
 * `oneTimePreKeys` is always an array of base64 strings.
 *
 * @param {object} row
 * @returns {object}
 */
function formatDevice(row) {
    return {
        id: String(row.id),
        userId: row.user_id,
        deviceName: row.device_name,
        identityKey: row.identity_key,
        signedPreKey: row.signed_pre_key,
        preKeySignature: row.pre_key_signature,
        oneTimePreKeys: parsePreKeys(row.one_time_pre_keys).map((k) => k.publicKey),
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
    };
}

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

        return res.json(result.rows.map(formatDevice));
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
            return res.status(400).json({ error: 'preKeySignature is required (base64 XEdDSA signature of signedPreKey).' });
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

        // base64 format + decoded length check. The server never uses the key
        // material itself; it only relays public keys.
        //   identityKey / signedPreKey / oneTimePreKeys: 33 bytes (0x05 + 32)
        //   preKeySignature: 64 bytes (XEdDSA signature)
        // NOTE: preKeySignature is an XEdDSA signature, not ed25519. XEdDSA
        // maps the Edwards curve to Montgomery form, so it is NOT compatible
        // with ed25519 verification and must not be verified as such here.
        if (!isBase64OfLength(identityKey, PUBLIC_KEY_BYTE_LENGTHS)
            || !isBase64OfLength(signedPreKey, PUBLIC_KEY_BYTE_LENGTHS)) {
            return res.status(400).json({
                error: 'identityKey and signedPreKey must be base64 encoded 33-byte X25519 public keys.',
            });
        }
        if (!isBase64OfLength(preKeySignature, SIGNATURE_BYTE_LENGTHS)) {
            return res.status(400).json({
                error: 'preKeySignature must be a base64 encoded 64-byte XEdDSA signature.',
            });
        }
        for (const key of oneTimePreKeys) {
            if (!isBase64OfLength(key, PUBLIC_KEY_BYTE_LENGTHS)) {
                return res.status(400).json({
                    error: 'All one-time prekeys must be base64 encoded 33-byte X25519 public keys.',
                });
            }
        }

        // Prekey ids are the array index (matches the client's local prekey ids)
        const preKeys = oneTimePreKeys.map((publicKey, index) => ({ id: index, publicKey }));

        const result = await query(
            `INSERT INTO user_devices (user_id, device_name, identity_key, signed_pre_key, pre_key_signature, one_time_pre_keys)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, user_id, device_name, identity_key, signed_pre_key, pre_key_signature, one_time_pre_keys, created_at, last_seen_at`,
            [userId, deviceName?.trim() || null, identityKey, signedPreKey, preKeySignature, JSON.stringify(preKeys)]
        );

        const device = result.rows[0];
        logger.info({ userId, deviceId: device.id }, 'Device registered');

        return res.status(201).json(formatDevice(device));
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

        // Keep push tokens consistent with the deleted device.
        await query(
            'DELETE FROM push_tokens WHERE user_id = $1 AND device_id = $2',
            [userId, String(deviceId)]
        );

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
// Returns: [Device]
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

        return res.json(result.rows.map(formatDevice));
    } catch (err) {
        logger.error({ err, params: req.params }, 'Failed to fetch user devices');
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
