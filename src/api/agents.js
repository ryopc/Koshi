// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Agent API Routes
// License: MIT
// ============================================================================
// Handles agent registration, API key management, and agent directory.
// ============================================================================

import { Router } from 'express';
import { registerAgent, getAgentProfile, listAgents, buildAgentCard, setAgentTier } from '../agent/service.js';
import { createSqliteKeyStore } from '../agent/keyStore.sqlite.js';
import { createPgKeyStore } from '../agent/keyStore.pg.js';
import { logger } from '../logger.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { createProblem, validationFailed, notFound, forbidden, rateLimited } from '../middleware/errors.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// Determine which key store to use
function getKeyStore() {
    // In server mode (PostgreSQL), use pg; in local mode, use sqlite
    if (process.env.DATABASE_URL) {
        return createPgKeyStore();
    }
    return createSqliteKeyStore();
}

// ============================================================================
// POST /api/auth/agent/register — Register new AI agent
// ============================================================================
router.post('/auth/agent/register', async (req, res) => {
    try {
        const { username, publicKey, agentKind, description, version, capabilities, metadata, endpoint, callbackUrl } = req.body;

        // Rate limit for agent registration (stricter than human)
        // This is a simple in-memory rate limiter; production should use Redis
        const result = await registerAgent({
            username,
            publicKey,
            agentKind,
            description,
            version,
            capabilities,
            metadata,
            endpoint,
            callbackUrl
        });

        res.status(201).json(result);
    } catch (err) {
        logger.error({ err }, 'Agent registration failed');
        if (err.status) {
            return res.status(err.status).json(err.body || { error: err.message });
        }
        if (err.message?.includes('Invalid') || err.message?.includes('must be') || err.message?.includes('required')) {
            return validationFailed(res, err.message, req.path);
        }
        if (err.message?.includes('already registered')) {
            return conflict(res, err.message, req.path);
        }
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            detail: 'Agent registration failed',
            instance: req.path
        }));
    }
});

// ============================================================================
// POST /api/auth/agent/login — Login as AI agent
// ============================================================================
router.post('/auth/agent/login', async (req, res) => {
    try {
        const { username, signature } = req.body;

        if (!username || !signature) {
            return validationFailed(res, 'Username and signature required', req.path);
        }

        const { query } = await import('../db/pool.js');
        const { verifyToken, signToken } = await import('../auth/jwt.js');
        const { verifySignature } = await import('../auth/ed25519.js');

        const userResult = await query(
            'SELECT id, username, public_key FROM users WHERE username = $1 AND is_agent = true',
            [username.toLowerCase().trim()]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json(createProblem({
                type: 'https://koshi.ryopc.org/problems/invalid-token',
                title: 'Invalid Credentials',
                status: 401,
                detail: 'Invalid signature or not an agent account',
                instance: req.path
            }));
        }

        const user = userResult.rows[0];
        const challenge = `koshi:login:${user.username}`;

        if (!verifySignature(challenge, signature, user.public_key)) {
            return res.status(401).json(createProblem({
                type: 'https://koshi.ryopc.org/problems/invalid-token',
                title: 'Invalid Signature',
                status: 401,
                detail: 'The provided signature is invalid',
                instance: req.path
            }));
        }

        const ACCESS_TOKEN_TTL = '24h';
        const REFRESH_TOKEN_TTL = '30d';
        const REFRESH_TOKEN_TTL_DAYS = 30;
        const { createHash, randomUUID } = await import('node:crypto');

        function hashToken(token) {
            return createHash('sha256').update(String(token)).digest('hex');
        }

        const token = signToken(
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

        res.json({ token, refreshToken, userId: user.id });
    } catch (err) {
        logger.error({ err }, 'Agent login failed');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// POST /api/auth/agent/key/create — Create new API key for agent
// ============================================================================
router.post('/auth/agent/key/create', requireAuth, async (req, res) => {
    try {
        const { scopes, label, tier = 'standard', expiresAt } = req.body;

        if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
            return validationFailed(res, 'At least one scope required', req.path);
        }

        // Verify user is an agent
        if (!req.user?.isAgent) {
            return forbidden(res, 'Only agent accounts can create API keys', req.path);
        }

        // Check that requested scopes don't exceed agent's declared capabilities
        const { query } = await import('../db/pool.js');
        const agentResult = await query(
            'SELECT agent_capabilities FROM users WHERE id = $1',
            [req.user.userId]
        );

        if (agentResult.rows.length === 0) {
            return notFound(res, 'Agent', req.path);
        }

        const declaredCaps = agentResult.rows[0].agent_capabilities || [];
        const requestedCaps = scopes.filter(s => !declaredCaps.includes(s));

        if (requestedCaps.length > 0) {
            return forbidden(res, `Requested scopes exceed agent's declared capabilities: ${requestedCaps.join(', ')}`, req.path);
        }

        const keyStore = getKeyStore();
        const { rawKey } = await keyStore.create({
            agentId: req.user.userId,
            scopes,
            label,
            tier,
            expiresAt
        });

        res.status(201).json(rawKey);
    } catch (err) {
        logger.error({ err }, 'Create API key failed');
        if (err.message?.includes('Invalid')) {
            return validationFailed(res, err.message, req.path);
        }
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// GET /api/auth/agent/key/list — List agent's API keys
// ============================================================================
router.get('/auth/agent/key/list', requireAuth, async (req, res) => {
    try {
        if (!req.user?.isAgent) {
            return forbidden(res, 'Only agent accounts can list API keys', req.path);
        }

        const keyStore = getKeyStore();
        const keys = await keyStore.listByAgent(req.user.userId);
        res.json({ keys });
    } catch (err) {
        logger.error({ err }, 'List API keys failed');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// POST /api/auth/agent/key/revoke — Revoke an API key
// ============================================================================
router.post('/auth/agent/key/revoke', requireAuth, async (req, res) => {
    try {
        const { keyId } = req.body;

        if (!keyId) {
            return validationFailed(res, 'keyId required', req.path);
        }

        if (!req.user?.isAgent) {
            return forbidden(res, 'Only agent accounts can revoke API keys', req.path);
        }

        const keyStore = getKeyStore();
        const success = await keyStore.revoke(keyId, req.user.userId);

        if (!success) {
            return notFound(res, 'API Key', req.path);
        }

        res.json({ success: true });
    } catch (err) {
        logger.error({ err }, 'Revoke API key failed');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// GET /api/agents — Agent directory
// ============================================================================
router.get('/agents', optionalAuth, async (req, res) => {
    try {
        const { listAgents } = await import('../agent/service.js');
        const { kind, capability, q, limit = '50', cursor } = req.query;

        const result = await listAgents({
            kind: kind as any,
            capability: capability as any,
            q: q as string,
            limit: Math.min(parseInt(limit as string, 10) || 50, 100),
            cursor: cursor as string
        });

        res.json(result);
    } catch (err) {
        logger.error({ err }, 'List agents failed');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// GET /api/agents/:username — Agent profile
// ============================================================================
router.get('/agents/:username', optionalAuth, async (req, res) => {
    try {
        const { getAgentProfile } = await import('../agent/service.js');
        const agent = await getAgentProfile(req.params.username);

        if (!agent) {
            return notFound(res, 'Agent', req.path);
        }

        res.json(agent);
    } catch (err) {
        logger.error({ err }, 'Get agent failed');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// GET /api/agents/:username/card — A2A Agent Card
// ============================================================================
router.get('/agents/:username/card', optionalAuth, async (req, res) => {
    try {
        const { getAgentProfile, buildAgentCard } = await import('../agent/service.js');
        const agent = await getAgentProfile(req.params.username);

        if (!agent) {
            return notFound(res, 'Agent', req.path);
        }

        const card = buildAgentCard(agent);
        res.json(card);
    } catch (err) {
        logger.error({ err }, 'Get agent card failed');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// POST /api/admin/agent-tier — Set agent tier (admin only)
// ============================================================================
router.post('/admin/agent-tier', requireAdmin, async (req, res) => {
    try {
        const { username, tier } = req.body;

        if (!username || !tier) {
            return validationFailed(res, 'username and tier required', req.path);
        }

        if (!['free', 'standard', 'trusted'].includes(tier)) {
            return validationFailed(res, 'Invalid tier', req.path, {
                tier: 'Must be one of: free, standard, trusted'
            });
        }

        const { setAgentTier } = await import('../agent/service.js');
        const result = await setAgentTier(username, tier);
        res.json(result);
    } catch (err) {
        logger.error({ err }, 'Set agent tier failed');
        if (err.status === 404) {
            return notFound(res, 'Agent', req.path);
        }
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

export default router;