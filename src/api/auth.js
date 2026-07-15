// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Authentication API Routes
// License: MIT
// ============================================================================
// Handles user registration and login using ed25519 keypairs.
//
// Register: User provides username + public key. Server stores them.
// Login:    User signs a challenge with their secret key. Server verifies
//           the signature against the stored public key and issues a JWT.
// ============================================================================

import { Router } from 'express';
import { query, getClient } from '../db/pool.js';
import { signToken } from '../auth/jwt.js';
import { verifySignature, derivePublicKey } from '../auth/ed25519.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { logger } from '../logger.js';

const router = Router();

// ============================================================================
// POST /api/auth/register
// ============================================================================
// Register a new user with an ed25519 public key.
//
// Body: { username: string, publicKey: string }
// The publicKey is the ed25519 public key (hex-encoded, 64 chars).
//
// Returns: { userId: UUID, token: string }
// ============================================================================
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { username, publicKey } = req.body;

        // -- Input validation --
        if (!username || typeof username !== 'string') {
            return res.status(400).json({ error: 'Username is required and must be a string.' });
        }
        if (!publicKey || typeof publicKey !== 'string') {
            return res.status(400).json({ error: 'Public key is required and must be a string.' });
        }

        const trimmedUsername = username.trim().toLowerCase();

        // Validate username format (alphanumeric, 3-32 chars, no special chars)
        if (!/^[a-z0-9_-]{3,32}$/.test(trimmedUsername)) {
            return res.status(400).json({
                error: 'Invalid username format.',
                message: 'Username must be 3-32 characters, alphanumeric with hyphens and underscores.',
            });
        }

        // Validate public key length (32 bytes = 64 hex chars)
        if (!/^[0-9a-f]{64}$/i.test(publicKey)) {
            return res.status(400).json({
                error: 'Invalid public key format.',
                message: 'Public key must be a 64-character hex string (32 bytes).',
            });
        }

        // -- Check for existing user --
        const existing = await query(
            'SELECT id FROM users WHERE username = $1 OR public_key = $2',
            [trimmedUsername, publicKey]
        );

        if (existing.rows.length > 0) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'Username or public key already registered.',
            });
        }

        // -- Create user --
        const result = await query(
            `INSERT INTO users (username, public_key)
             VALUES ($1, $2)
             RETURNING id, username, public_key, created_at`,
            [trimmedUsername, publicKey]
        );

        const user = result.rows[0];

        // -- Generate JWT --
        const token = signToken({ userId: user.id, username: user.username });

        logger.info({ userId: user.id, username: user.username }, 'User registered');

        return res.status(201).json({
            userId: user.id,
            token,
        });
    } catch (err) {
        logger.error({ err }, 'Registration failed');
        return res.status(500).json({ error: 'Internal server error', message: 'Could not complete registration.' });
    }
});

// ============================================================================
// POST /api/auth/login
// ============================================================================
// Authenticate a user by verifying an ed25519 signature.
//
// Body: { username: string, signature: string }
// The signature is the hex-encoded ed25519 signature of the challenge string.
//
// Returns: { token: string, userId: UUID }
// ============================================================================
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { username, signature } = req.body;

        // -- Input validation --
        if (!username || typeof username !== 'string') {
            return res.status(400).json({ error: 'Username is required and must be a string.' });
        }
        if (!signature || typeof signature !== 'string') {
            return res.status(400).json({ error: 'Signature is required and must be a string.' });
        }

        const trimmedUsername = username.trim().toLowerCase();

        // -- Look up user --
        const result = await query(
            'SELECT id, username, public_key FROM users WHERE username = $1',
            [trimmedUsername]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found', message: 'No account with that username.' });
        }

        const user = result.rows[0];

        // -- Verify signature --
        // The challenge message is: "login:{username}:{timestamp}"
        // We'll use a simple challenge format. In practice, the server
        // would issue a nonce, but for CLI clients this pattern works.
        const challenge = `koshi:login:${user.username}`;
        const isValid = await verifySignature(challenge, signature, user.public_key);

        if (!isValid) {
            return res.status(401).json({ error: 'Authentication failed', message: 'Invalid signature.' });
        }

        // -- Generate JWT --
        const token = signToken({ userId: user.id, username: user.username });

        logger.info({ userId: user.id, username: user.username }, 'User logged in');

        return res.json({
            token,
            userId: user.id,
        });
    } catch (err) {
        logger.error({ err }, 'Login failed');
        return res.status(500).json({ error: 'Internal server error', message: 'Could not complete login.' });
    }
});

export default router;
