// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// API Key Storage — PostgreSQL Implementation
// License: MIT
// ============================================================================
// Uses the pg pool from src/db/pool.js
// ============================================================================

import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import { normalizeCapabilities, validateTier } from './capabilities.js';

const KEY_PREFIX = 'ak_live_';
const KEY_BYTES = 24; // 24 bytes = 48 hex chars after prefix

function generateRawKey() {
    const bytes = randomBytes(KEY_BYTES);
    const suffix = bytes.toString('hex');
    const raw = `${KEY_PREFIX}${suffix}`;
    const prefix = raw.slice(0, KEY_PREFIX.length + 4); // "ak_live_abcd"
    const hash = createHash('sha256').update(raw).digest('hex');
    return { key: raw, prefix, hash };
}

function hashKey(rawKey) {
    return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Create a PostgreSQL-backed KeyStore.
 */
export function createPgKeyStore() {
    return {
        /**
         * Create a new API key for an agent.
         */
        async create({
            agentId,
            scopes,
            label,
            tier = 'standard',
            expiresAt
        }) {
            // Validate
            const normalizedScopes = normalizeCapabilities(scopes);
            if (!validateTier(tier)) {
                throw new Error(`Invalid tier: ${tier}`);
            }

            const { key, prefix, hash: keyHash } = generateRawKey();
            const id = randomUUID();
            const scopesJson = JSON.stringify(normalizedScopes);

            await query(
                `INSERT INTO agent_api_keys (id, agent_id, key_hash, key_prefix, scopes, label, tier, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [id, agentId, keyHash, prefix, scopesJson, label || null, tier, expiresAt || null]
            );

            const stored = {
                id,
                agentId,
                keyHash,
                keyPrefix: prefix,
                scopes: normalizedScopes,
                label: label || undefined,
                tier,
                lastUsedAt: undefined,
                expiresAt: expiresAt || undefined,
                revoked: false,
                createdAt: new Date().toISOString()
            };

            return {
                rawKey: { key, prefix },
                stored
            };
        },

        /**
         * Verify a raw API key.
         * Returns the stored record if valid, not revoked, not expired.
         */
        async verify(rawKey) {
            const keyHash = hashKey(rawKey);

            const result = await query(
                `SELECT id, agent_id, key_hash, key_prefix, scopes, label, tier,
                        last_used_at, expires_at, revoked, created_at
                 FROM agent_api_keys
                 WHERE key_hash = $1`,
                [keyHash]
            );

            if (result.rows.length === 0) {
                return null;
            }

            const row = result.rows[0];

            if (row.revoked) {
                return null;
            }

            if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
                return null;
            }

            return {
                id: row.id,
                agentId: row.agent_id,
                keyHash: row.key_hash,
                keyPrefix: row.key_prefix,
                scopes: JSON.parse(row.scopes || '[]'),
                label: row.label || undefined,
                tier: row.tier,
                lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined,
                expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
                revoked: row.revoked,
                createdAt: new Date(row.created_at).toISOString()
            };
        },

        /**
         * List all API keys for an agent.
         */
        async listByAgent(agentId) {
            const result = await query(
                `SELECT id, agent_id, key_hash, key_prefix, scopes, label, tier,
                        last_used_at, expires_at, revoked, created_at
                 FROM agent_api_keys
                 WHERE agent_id = $1
                 ORDER BY created_at DESC`,
                [agentId]
            );

            return result.rows.map(row => ({
                id: row.id,
                agentId: row.agent_id,
                keyHash: row.key_hash,
                keyPrefix: row.key_prefix,
                scopes: JSON.parse(row.scopes || '[]'),
                label: row.label || undefined,
                tier: row.tier,
                lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined,
                expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
                revoked: row.revoked,
                createdAt: new Date(row.created_at).toISOString()
            }));
        },

        /**
         * Revoke an API key.
         */
        async revoke(keyId, agentId) {
            const result = await query(
                `UPDATE agent_api_keys SET revoked = true WHERE id = $1 AND agent_id = $2`,
                [keyId, agentId]
            );
            return result.rowCount > 0;
        },

        /**
         * Update last_used_at (throttled: max once per 5 minutes).
         */
        async touchLastUsed(keyId) {
            await query(
                `UPDATE agent_api_keys
                 SET last_used_at = NOW()
                 WHERE id = $1
                   AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '5 minutes')`,
                [keyId]
            );
        },

        /**
         * Get a key by ID.
         */
        async getById(keyId) {
            const result = await query(
                `SELECT id, agent_id, key_hash, key_prefix, scopes, label, tier,
                        last_used_at, expires_at, revoked, created_at
                 FROM agent_api_keys
                 WHERE id = $1`,
                [keyId]
            );

            if (result.rows.length === 0) return null;

            const row = result.rows[0];
            return {
                id: row.id,
                agentId: row.agent_id,
                keyHash: row.key_hash,
                keyPrefix: row.key_prefix,
                scopes: JSON.parse(row.scopes || '[]'),
                label: row.label || undefined,
                tier: row.tier,
                lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined,
                expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
                revoked: row.revoked,
                createdAt: new Date(row.created_at).toISOString()
            };
        }
    };
}