// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// API Key Storage — SQLite Implementation (for serverless/local mode)
// License: MIT
// ============================================================================
// Uses the local database from src/local/db.js
// ============================================================================

import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { getDB } from '../local/db.js';
import { logger } from '../logger.js';
import { normalizeCapabilities, validateTier } from './capabilities.js';

const KEY_PREFIX = 'ak_live_';
const KEY_BYTES = 24;

function generateRawKey() {
    const bytes = randomBytes(KEY_BYTES);
    const suffix = bytes.toString('hex');
    const raw = `${KEY_PREFIX}${suffix}`;
    const prefix = raw.slice(0, KEY_PREFIX.length + 4);
    const hash = createHash('sha256').update(raw).digest('hex');
    return { key: raw, prefix, hash };
}

function hashKey(rawKey) {
    return createHash('sha256').update(rawKey).digest('hex');
}

function nowIso() {
    return new Date().toISOString();
}

/**
 * Create a SQLite-backed KeyStore.
 * Uses the same local.db as the rest of the serverless mode.
 */
export function createSqliteKeyStore() {
    const db = getDB();

    // Prepared statements for performance
    const stmtInsert = db.prepare(`
        INSERT INTO agent_api_keys (id, agent_id, key_hash, key_prefix, scopes, label, tier, expires_at, revoked, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const stmtVerify = db.prepare(`
        SELECT id, agent_id, key_hash, key_prefix, scopes, label, tier, last_used_at, expires_at, revoked, created_at
        FROM agent_api_keys
        WHERE key_hash = ?
    `);

    const stmtList = db.prepare(`
        SELECT id, agent_id, key_hash, key_prefix, scopes, label, tier, last_used_at, expires_at, revoked, created_at
        FROM agent_api_keys
        WHERE agent_id = ?
        ORDER BY created_at DESC
    `);

    const stmtRevoke = db.prepare(`
        UPDATE agent_api_keys SET revoked = 1 WHERE id = ? AND agent_id = ?
    `);

    const stmtTouch = db.prepare(`
        UPDATE agent_api_keys
        SET last_used_at = ?
        WHERE id = ?
          AND (last_used_at IS NULL OR last_used_at < datetime(?, '-5 minutes'))
    `);

    const stmtGetById = db.prepare(`
        SELECT id, agent_id, key_hash, key_prefix, scopes, label, tier, last_used_at, expires_at, revoked, created_at
        FROM agent_api_keys
        WHERE id = ?
    `);

    function mapRow(row) {
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
            revoked: !!row.revoked,
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined
        };
    }

    return {
        async create({
            agentId,
            scopes,
            label,
            tier = 'standard',
            expiresAt
        }) {
            const normalizedScopes = normalizeCapabilities(scopes);
            if (!validateTier(tier)) {
                throw new Error(`Invalid tier: ${tier}`);
            }

            const { key, prefix, hash: keyHash } = generateRawKey();
            const id = randomUUID();
            const scopesJson = JSON.stringify(normalizedScopes);
            const created = nowIso();

            stmtInsert.run(id, agentId, keyHash, prefix, scopesJson, label || null, tier, expiresAt || null, 0, created);

            return {
                rawKey: { key, prefix },
                stored: {
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
                    createdAt: created
                }
            };
        },

        async verify(rawKey) {
            const keyHash = hashKey(rawKey);
            const row = stmtVerify.get(keyHash);

            if (!row) return null;
            if (row.revoked) return null;

            if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
                return null;
            }

            return mapRow(row);
        },

        async listByAgent(agentId) {
            const rows = stmtList.all(agentId);
            return rows.map(mapRow);
        },

        async revoke(keyId, agentId) {
            const info = stmtRevoke.run(keyId, agentId);
            return info.changes > 0;
        },

        async touchLastUsed(keyId) {
            const now = nowIso();
            const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            stmtTouch.run(now, keyId, fiveMinAgo);
        },

        async getById(keyId) {
            const row = stmtGetById.get(keyId);
            if (!row) return null;
            return mapRow(row);
        }
    };
}

function mapRow(row) {
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
        revoked: !!row.revoked,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined
    };
}