// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Agent Service — Registration, Profiles, Agent Cards
// License: MIT
// ============================================================================
// Handles agent account lifecycle and A2A Agent Card generation.
// ============================================================================

import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import { createProblem, conflict, validationFailed, notFound } from '../middleware/errors.js';
import { normalizeCapabilities, validateAgentKind, AGENT_CAPABILITIES } from './capabilities.js';

const BASE_URL = process.env.KOSHI_BASE_URL || 'https://koshi.ryopc.org';

/**
 * Register a new AI agent account.
 * Returns JWT tokens + raw API key (shown once).
 */
export async function registerAgent(data) {
    const { username, publicKey, agentKind, description, version, capabilities, metadata, endpoint, callbackUrl } = data;

    // Validate
    const uname = username.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,32}$/.test(uname)) {
        throw validationFailed(null, 'Invalid username format', '/api/auth/agent/register', {
            username: 'Must be 3-32 chars, alphanumeric with hyphens/underscores'
        });
    }

    if (!/^[0-9a-f]{64}$/i.test(publicKey)) {
        throw validationFailed(null, 'Invalid public key format', '/api/auth/agent/register', {
            publicKey: 'Must be 64-char hex string (32 bytes)'
        });
    }

    if (!validateAgentKind(agentKind)) {
        throw validationFailed(null, 'Invalid agent kind', '/api/auth/agent/register', {
            agentKind: `Must be one of: llm, bot, automation, service`
        });
    }

    if (!capabilities || capabilities.length === 0) {
        throw validationFailed(null, 'At least one capability required', '/api/auth/agent/register', {
            capabilities: 'Must include at least one capability'
        });
    }

    const normalizedCaps = normalizeCapabilities(capabilities);

    // Check for existing username or public key
    const existing = await query(
        'SELECT id FROM users WHERE username = $1 OR public_key = $2',
        [uname, publicKey]
    );

    if (existing.rows.length > 0) {
        throw conflict(null, 'Username or public key already registered', '/api/auth/agent/register');
    }

    // Create user with agent fields
    const result = await query(
        `INSERT INTO users (username, public_key, display_name, bio, is_agent, agent_kind, agent_version, agent_description, agent_capabilities, agent_metadata, agent_endpoint, agent_callback_url)
         VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, username, created_at`,
        [
            uname,
            publicKey,
            description || uname,
            description || `AI agent: ${uname}`,
            agentKind,
            version || null,
            description || null,
            JSON.stringify(normalizedCaps),
            JSON.stringify(metadata || {}),
            endpoint || null,
            callbackUrl || null
        ]
    );

    const user = result.rows[0];

    // Issue JWT tokens
    const { signToken } = await import('../auth/jwt.js');
    const ACCESS_TOKEN_TTL = '24h';
    const REFRESH_TOKEN_TTL = '30d';
    const REFRESH_TOKEN_TTL_DAYS = 30;
    const { createHash, randomUUID } = await import('node:crypto');

    function hashToken(token) {
        return createHash('sha256').update(String(token)).digest('hex');
    }

    const accessToken = signToken(
        { userId: user.id, username: user.username },
        { type: 'access', expiresIn: ACCESS_TOKEN_TTL }
    );

    const refreshToken = signToken(
        { userId: user.id, username: user.username, jti: randomUUID() },
        { type: 'refresh', expiresIn: REFRESH_TOKEN_TTL }
    );

    await query(
        `INSERT INTO refresh_tokens (token_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '${REFRESH_TOKEN_TTL_DAYS} days')`,
        [hashToken(refreshToken), user.id]
    );

    // Create initial API key with all registered capabilities
    const { createSqliteKeyStore } = await import('./keyStore.sqlite.js');
    const keyStore = createSqliteKeyStore(); // In server mode, we'd use pg; for now both work
    const { rawKey } = await keyStore.create({
        agentId: user.id,
        scopes: normalizedCaps,
        label: 'Initial key',
        tier: 'standard'
    });

    return {
        userId: user.id,
        token: accessToken,
        refreshToken,
        agentId: user.id,
        apiKey: rawKey
    };
}

/**
 * Build an A2A-compliant Agent Card from a user profile.
 * Koshi-specific extensions are placed in metadata.koshi (per D3 decision).
 */
export function buildAgentCard(profile) {
    const baseUrl = `${BASE_URL}/api/agents/${profile.username}`;

    return {
        name: profile.display_name || profile.username,
        description: profile.agent_description || profile.bio || `Koshi agent: ${profile.username}`,
        url: profile.agent_endpoint || baseUrl,
        provider: {
            name: 'koshi',
            url: 'https://koshi.ryopc.org'
        },
        version: profile.agent_version || '1.0.0',
        capabilities: (profile.agent_capabilities || []).map(c => ({
            name: c,
            description: c
        })),
        skills: (profile.agent_capabilities || []).map(c => ({
            name: c,
            description: `Can ${c.replace(':', ' ')}`,
            tags: [c.split(':')[0]],
            examples: []
        })),
        metadata: {
            koshi: {
                username: profile.username,
                agentKind: profile.agent_kind,
                agentVersion: profile.agent_version,
                agentCapabilities: profile.agent_capabilities || [],
                endpoint: profile.agent_endpoint,
                callbackUrl: profile.agent_callback_url,
                model: profile.agent_metadata?.model,
                provider: profile.agent_metadata?.provider
            }
        }
    };
}

/**
 * Get agent profile by username (for directory/card endpoints).
 */
export async function getAgentProfile(username) {
    const result = await query(
        `SELECT id, username, display_name, bio, avatar_url, is_admin,
                is_agent, agent_kind, agent_version, agent_description,
                agent_capabilities, agent_metadata, agent_endpoint, agent_callback_url,
                created_at, updated_at
         FROM users
         WHERE username = $1 AND is_agent = true`,
        [username.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
        return null;
    }

    const row = result.rows[0];
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        bio: row.bio,
        avatarUrl: row.avatar_url,
        isAdmin: !!row.is_admin,
        isAgent: true,
        agentKind: row.agent_kind,
        agentVersion: row.agent_version,
        agentDescription: row.agent_description,
        agentCapabilities: row.agent_capabilities || [],
        agentMetadata: row.agent_metadata || {},
        agentEndpoint: row.agent_endpoint,
        agentCallbackUrl: row.agent_callback_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * List agents with optional filters.
 */
export async function listAgents(filters) {
    const { kind, capability, q, limit = 50, cursor } = filters;
    const lim = Math.min(limit, 100);

    let where = 'WHERE is_agent = true';
    const params = [];

    if (kind) {
        params.push(kind);
        where += ` AND agent_kind = $${params.length}`;
    }
    if (capability) {
        params.push(capability);
        where += ` AND $${params.length} = ANY(agent_capabilities)`;
    }
    if (q) {
        params.push(`%${q}%`);
        where += ` AND (username ILIKE $${params.length} OR display_name ILIKE $${params.length} OR agent_description ILIKE $${params.length})`;
    }
    if (cursor) {
        params.push(cursor);
        where += ` AND id > $${params.length}`;
    }

    params.push(lim + 1);
    const result = await query(
        `SELECT id, username, display_name, bio, avatar_url, is_agent, agent_kind, agent_version, agent_description,
                agent_capabilities, agent_metadata, agent_endpoint, agent_callback_url, created_at
         FROM users ${where}
         ORDER BY created_at ASC
         LIMIT $${params.length}`,
        params
    );

    const rows = result.rows.slice(0, lim);
    const items = rows.map(row => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        bio: row.bio,
        avatarUrl: row.avatar_url,
        isAgent: true,
        agentKind: row.agent_kind,
        agentVersion: row.agent_version,
        agentDescription: row.agent_description,
        agentCapabilities: row.agent_capabilities || [],
        agentMetadata: row.agent_metadata || {},
        agentEndpoint: row.agent_endpoint,
        agentCallbackUrl: row.agent_callback_url,
        createdAt: row.created_at
    }));

    const nextCursor = rows.length > lim ? rows[lim].id : null;

    return { items, nextCursor, total: null };
}

/**
 * Update agent metadata (called from PUT /api/users/me).
 */
export async function updateAgentMetadata(userId, updates) {
    const { agentDescription, agentMetadata, agentEndpoint, agentCallbackUrl } = updates;

    const set = [];
    const params = [];

    if (agentDescription !== undefined) {
        set.push('agent_description = $' + (params.length + 1));
        params.push(agentDescription);
    }
    if (agentMetadata !== undefined) {
        set.push('agent_metadata = $' + (params.length + 1));
        params.push(JSON.stringify(agentMetadata));
    }
    if (agentEndpoint !== undefined) {
        set.push('agent_endpoint = $' + (params.length + 1));
        params.push(agentEndpoint);
    }
    if (agentCallbackUrl !== undefined) {
        set.push('agent_callback_url = $' + (params.length + 1));
        params.push(agentCallbackUrl);
    }

    if (set.length === 0) return null;

    set.push("updated_at = NOW()");
    params.push(userId);

    const result = await query(
        `UPDATE users SET ${set.join(', ')} WHERE id = $${params.length} AND is_agent = true
         RETURNING id, username, display_name, bio, avatar_url, is_admin,
                   is_agent, agent_kind, agent_version, agent_description,
                   agent_capabilities, agent_metadata, agent_endpoint, agent_callback_url,
                   created_at, updated_at`,
        params
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        bio: row.bio,
        avatarUrl: row.avatar_url,
        isAdmin: !!row.is_admin,
        isAgent: true,
        agentKind: row.agent_kind,
        agentVersion: row.agent_version,
        agentDescription: row.agent_description,
        agentCapabilities: row.agent_capabilities || [],
        agentMetadata: row.agent_metadata || {},
        agentEndpoint: row.agent_endpoint,
        agentCallbackUrl: row.agent_callback_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Set agent tier (admin only).
 */
export async function setAgentTier(username, tier) {
    // This is a placeholder - actual tier is stored on API keys, not the user
    // But we can store a default tier preference on the user
    const result = await query(
        `UPDATE users SET agent_metadata = COALESCE(agent_metadata, '{}') || jsonb_build_object('defaultTier', $1)
         WHERE username = $2 AND is_agent = true
         RETURNING id, username`,
        [tier, username.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
        throw notFound(null, 'Agent', `/api/admin/agent-tier`);
    }

    return { success: true };
}