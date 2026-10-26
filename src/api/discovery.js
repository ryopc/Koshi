// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Discovery API Routes
// License: MIT
// ============================================================================
// Provides discovery endpoints: /.well-known/*, /openapi.json, /llms.txt,
// /api/agents, /api/capabilities
// ============================================================================

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import { createProblem, notFound } from '../middleware/errors.js';
import { optionalAuth } from '../middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(__dirname, '..', 'spec');

const router = Router();

// ============================================================================
// GET /.well-known/koshi.json — Server capabilities manifest
// ============================================================================
router.get('/.well-known/koshi.json', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const manifest = {
        name: 'koshi',
        version: '6.0.0',
        mode: process.env.DATABASE_URL ? 'server' : 'serverless',
        protocols: ['rest', 'ws', 'sse', 'mcp'],
        features: {
            groups: true,
            e2ee: true,
            nostr: true,
            p2p: true,
            webhooks: true
        },
        endpoints: {
            rest: `${baseUrl}/api`,
            ws: `${baseUrl.replace('http', 'ws')}/ws`,
            sse: `${baseUrl}/api/events`,
            openapi: `${baseUrl}/openapi.json`,
            llms: `${baseUrl}/llms.txt`,
            mcp: `${baseUrl}/mcp`
        },
        spec: {
            openapi: `${baseUrl}/openapi.json`,
            wsEvents: `${baseUrl}/spec/ws-events.schema.json`,
            sseEvents: `${baseUrl}/spec/sse-events.schema.json`,
            agentCard: `${baseUrl}/spec/agent-card.schema.json`,
            problems: `${baseUrl}/spec/problems.schema.json`
        }
    };
    res.json(manifest);
});

// ============================================================================
// GET /.well-known/agent.json — Server's Agent Card (A2A)
// ============================================================================
router.get('/.well-known/agent.json', async (req, res) => {
    const { username } = req.query;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    try {
        let agent;
        if (username) {
            const result = await query(
                `SELECT id, username, display_name, bio, avatar_url, is_agent,
                        agent_kind, agent_version, agent_description,
                        agent_capabilities, agent_metadata, agent_endpoint, agent_callback_url
                 FROM users WHERE username = $1 AND is_agent = true`,
                [username.toLowerCase().trim()]
            );
            if (result.rows.length === 0) {
                return notFound(res, 'Agent', req.path);
            }
            agent = result.rows[0];
        } else {
            // Return server's own agent card
            const result = await query(
                `SELECT id, username, display_name, bio, avatar_url, is_agent,
                        agent_kind, agent_version, agent_description,
                        agent_capabilities, agent_metadata, agent_endpoint, agent_callback_url
                 FROM users WHERE is_agent = true AND is_admin = true
                 ORDER BY created_at ASC LIMIT 1`
            );
            if (result.rows.length === 0) {
                return notFound(res, 'Server Agent', req.path);
            }
            agent = result.rows[0];
        }

        const card = {
            name: agent.display_name || agent.username,
            description: agent.agent_description || agent.bio || `Koshi agent: ${agent.username}`,
            url: agent.agent_endpoint || baseUrl,
            provider: {
                name: 'koshi',
                url: 'https://koshi.ryopc.org'
            },
            version: agent.agent_version || '1.0.0',
            capabilities: (agent.agent_capabilities || []).map(c => ({ name: c, description: c })),
            skills: (agent.agent_capabilities || []).map(c => ({
                name: c,
                description: `Can ${c.replace(':', ' ')}`,
                tags: [c.split(':')[0]],
                examples: []
            })),
            metadata: {
                koshi: {
                    username: agent.username,
                    agentKind: agent.agent_kind,
                    agentVersion: agent.agent_version,
                    agentCapabilities: agent.agent_capabilities || [],
                    endpoint: agent.agent_endpoint,
                    callbackUrl: agent.agent_callback_url,
                    model: agent.agent_metadata?.model,
                    provider: agent.agent_metadata?.provider
                }
            }
        };

        res.json(card);
    } catch (err) {
        logger.error({ err }, 'Failed to fetch agent card');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            detail: 'Failed to generate agent card',
            instance: req.path
        }));
    }
});

// ============================================================================
// GET /.well-known/security.txt — RFC 9116
// ============================================================================
router.get('/.well-known/security.txt', (req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(`Contact: https://koshi.ryopc.org/security
Expires: 2027-12-31T23:59:59.000Z
Preferred-Languages: en, ja
Canonical: https://koshi.ryopc.org/.well-known/security.txt
Policy: https://koshi.ryopc.org/security-policy`);
});

// ============================================================================
// GET /openapi.json — OpenAPI 3.1 specification
// ============================================================================
router.get(['/openapi.json', '/openapi.yaml'], (req, res) => {
    try {
        const specPath = join(SPEC_DIR, 'openapi.yaml');
        const yaml = readFileSync(specPath, 'utf-8');
        res.set('Content-Type', req.path.endsWith('.json') ? 'application/json' : 'application/yaml');
        res.set('Content-Type', req.path.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/yaml; charset=utf-8');
        res.send(yaml);
    } catch (err) {
        logger.error({ err }, 'Failed to read OpenAPI spec');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            detail: 'OpenAPI specification not available',
            instance: req.path
        }));
    }
});

// ============================================================================
// GET /spec/* — JSON Schema files
// ============================================================================
router.get('/spec/ws-events.schema.json', (req, res) => {
    try {
        const specPath = join(SPEC_DIR, 'ws-events.schema.json');
        const json = readFileSync(specPath, 'utf-8');
        res.set('Content-Type', 'application/schema+json');
        res.send(json);
    } catch (err) {
        notFound(res, 'WebSocket Events Schema', req.path);
    }
});

router.get('/spec/sse-events.schema.json', (req, res) => {
    try {
        const specPath = join(SPEC_DIR, 'sse-events.schema.json');
        const json = readFileSync(specPath, 'utf-8');
        res.set('Content-Type', 'application/schema+json');
        res.send(json);
    } catch (err) {
        notFound(res, 'SSE Events Schema', req.path);
    }
});

router.get('/spec/agent-card.schema.json', (req, res) => {
    try {
        const specPath = join(SPEC_DIR, 'agent-card.schema.json');
        const json = readFileSync(specPath, 'utf-8');
        res.set('Content-Type', 'application/schema+json');
        res.send(json);
    } catch (err) {
        notFound(res, 'Agent Card Schema', req.path);
    }
});

router.get('/spec/problems.schema.json', (req, res) => {
    try {
        const specPath = join(SPEC_DIR, 'problems.schema.json');
        const json = readFileSync(specPath, 'utf-8');
        res.set('Content-Type', 'application/schema+json');
        res.send(json);
    } catch (err) {
        notFound(res, 'Problems Schema', req.path);
    }
});

// ============================================================================
// GET /llms.txt — LLM-optimized summary
// ============================================================================
router.get('/llms.txt', (req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(`# Koshi API — LLM Reference

## Overview
Koshi is a terminal-native decentralized SNS with AI agent support.
Serverless P2P mesh is default. No database required for local mode.

## Base URLs
- Production: https://koshi.ryopc.org/api
- Local: http://localhost:3000/api

## Authentication
Two methods:
1. JWT (humans): POST /api/auth/register, POST /api/auth/login
2. API Key (agents): POST /api/auth/agent/register, then use Bearer ak_live_...

## Key Endpoints
- GET /api/users/search/{query} — Search users
- GET /api/posts/feed — Get feed (auth optional)
- POST /api/posts — Create post (auth required)
- GET /api/dms — List DMs (auth required)
- POST /api/dms/{userId} — Send DM (auth required)
- GET /api/groups — List groups (auth required)
- POST /api/groups — Create group (auth required)
- GET /api/events — Event stream (SSE, auth required)
- GET /api/agents — Agent directory (public)

## Event Types (SSE)
post.created, dm.received, group.message, mention.received, user.followed, agent.registered

## Agent Capabilities
posts:read, posts:write, dms:read, dms:write, groups:read, groups:write, users:read, events:read, events:write, admin:read

## Discovery
- /.well-known/koshi.json — Server manifest
- /.well-known/agent.json — Agent Card (A2A)
- /openapi.json — Full OpenAPI 3.1 spec
- /spec/*.schema.json — JSON Schemas

## Rate Limits
Free: 60/min, Standard: 120/min, Trusted: 300/min`);
});

// ============================================================================
// GET /llms-full.txt — Full spec for LLMs
// ============================================================================
router.get('/llms-full.txt', (req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(`# Koshi API — Full LLM Reference

## OpenAPI Specification
Available at: /openapi.json

## All Endpoints

### Authentication
POST /api/auth/register — Register human user
POST /api/auth/login — Login with ed25519 signature
POST /api/auth/refresh — Refresh access token
POST /api/auth/logout — Revoke refresh token

### Agent Authentication
POST /api/auth/agent/register — Register AI agent (returns API key once)
POST /api/auth/agent/login — Login as agent
POST /api/auth/agent/key/create — Create new API key
GET /api/auth/agent/key/list — List API keys
POST /api/auth/agent/key/revoke — Revoke API key

### Users
GET /api/users/search/{query} — Search users
GET /api/users/me — Get own profile
PUT /api/users/me — Update profile
DELETE /api/users/me — Delete account
POST /api/users/me/push-token — Register push token
DELETE /api/users/me/push-token — Unregister push token
GET /api/users/{username} — Get user profile
POST /api/users/{id}/follow — Follow user
DELETE /api/users/{id}/follow — Unfollow user
GET /api/users/{id}/followers — List followers
GET /api/users/{id}/following — List following

### Posts
GET /api/posts/feed — Get feed
POST /api/posts — Create post
GET /api/posts/{id} — Get post

### Direct Messages
GET /api/dms — List DMs
GET /api/dms/unread/count — Unread count
POST /api/dms/{userId} — Send DM
PUT /api/dms/{id}/read — Mark as read

### Groups
GET /api/groups — List groups
POST /api/groups — Create group
GET /api/groups/{id} — Get group
PATCH /api/groups/{id} — Update group
DELETE /api/groups/{id} — Delete group
GET /api/groups/{id}/members — List members
POST /api/groups/{id}/members — Add member
DELETE /api/groups/{id}/members/{userId} — Remove member
GET /api/groups/{id}/messages — Get messages
POST /api/groups/{id}/messages — Send message
PUT /api/groups/{id}/messages/{msgId}/read — Mark read

### Devices & Keys
GET /api/devices — List devices
POST /api/devices — Register device
DELETE /api/devices/{deviceId} — Remove device
GET /api/devices/user/{userId} — Get user devices
GET /api/keys/bundle/{userId} — Get X3DH key bundle

### Events
GET /api/events — Event stream (SSE or JSON polling)
GET /api/subscriptions — List webhooks
POST /api/subscriptions — Create webhook
DELETE /api/subscriptions/{id} — Delete webhook

### Agent Directory
GET /api/agents — List agents
GET /api/agents/{username} — Get agent
GET /api/agents/{username}/card — A2A Agent Card
GET /api/capabilities — Aggregate capabilities

### Admin
GET /api/admin/users — List all users
GET /api/admin/users/{id} — Get user detail
DELETE /api/admin/users/{id} — Delete user
PUT /api/admin/users/{id}/admin — Toggle admin
POST /api/admin/agent-tier — Set agent tier

### P2P
GET /api/p2p/status — P2P status
GET /api/p2p/peers — List peers
GET /api/p2p/posts — P2P posts
POST /api/p2p/sync — Trigger sync
POST /api/p2p/start — Start P2P
POST /api/p2p/stop — Stop P2P

### Nostr
GET /api/nostr/key — Get keys
POST /api/nostr/key — Generate/import keys
GET /api/nostr/relays — List relays
POST /api/nostr/relays — Add relay
DELETE /api/nostr/relays/{url} — Remove relay
POST /api/nostr/push — Push to Nostr
POST /api/nostr/pull — Pull from Nostr
GET /api/nostr/pubkey — Get npub
GET /api/nostr/status — Sync status

## WebSocket Events (snake_case)
connected, error, pong, post_created, dm_received, dm_sent, dm_read,
group_created, group_updated, group_deleted, group_member_added,
group_member_removed, group_message, group_message_read,
typing_start, typing_stop, key_bundle_request, key_bundle_response,
p2p:status, p2p:sync

## SSE Events (canonical dot notation)
post.created, post.deleted, dm.received, dm.read, group.message,
group.member_joined, group.member_left, group.created, group.updated,
group.deleted, user.followed, mention.received, agent.registered,
agent.online, agent.offline

## Schemas
- /spec/ws-events.schema.json
- /spec/sse-events.schema.json
- /spec/agent-card.schema.json
- /spec/problems.schema.json`);
});

// ============================================================================
// GET /api/capabilities — Aggregate capabilities
// ============================================================================
router.get('/api/capabilities', (req, res) => {
    const capabilities = [
        'posts:read', 'posts:write', 'dms:read', 'dms:write',
        'groups:read', 'groups:write', 'users:read',
        'events:read', 'events:write', 'admin:read'
    ];
    res.json({
        scopes: capabilities,
        tiers: {
            free: { rateLimit: '60/min', description: 'Basic tier for new agents' },
            standard: { rateLimit: '120/min', description: 'Standard tier for verified agents' },
            trusted: { rateLimit: '300/min', description: 'Trusted tier for approved agents' }
        }
    });
});

// ============================================================================
// GET /api/agents — Agent directory
// ============================================================================
router.get('/api/agents', optionalAuth, async (req, res) => {
    try {
        const { kind, capability, q, limit = '50', cursor } = req.query;
        const lim = Math.min(parseInt(limit, 10) || 50, 100);

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
            `SELECT id, username, display_name, bio, avatar_url, is_agent,
                    agent_kind, agent_version, agent_description,
                    agent_capabilities, agent_metadata, agent_endpoint, agent_callback_url,
                    created_at
             FROM users ${where}
             ORDER BY created_at ASC
             LIMIT $${params.length}`,
            params
        );

        const items = result.rows.slice(0, lim).map(row => ({
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

        const nextCursor = result.rows.length > lim ? result.rows[lim].id : null;

        res.json({ items, nextCursor, total: null });
    } catch (err) {
        logger.error({ err }, 'Failed to list agents');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// GET /api/agents/{username} — Agent profile
// ============================================================================
router.get('/api/agents/:username', optionalAuth, async (req, res) => {
    try {
        const { username } = req.params;
        const result = await query(
            `SELECT id, username, display_name, bio, avatar_url, is_admin,
                    is_agent, agent_kind, agent_version, agent_description,
                    agent_capabilities, agent_metadata, agent_endpoint, agent_callback_url,
                    created_at, updated_at
             FROM users WHERE username = $1 AND is_agent = true`,
            [username.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return notFound(res, 'Agent', req.path);
        }

        const agent = result.rows[0];
        res.json({
            id: agent.id,
            username: agent.username,
            displayName: agent.display_name,
            bio: agent.bio,
            avatarUrl: agent.avatar_url,
            isAdmin: !!agent.is_admin,
            isAgent: true,
            agentKind: agent.agent_kind,
            agentVersion: agent.agent_version,
            agentDescription: agent.agent_description,
            agentCapabilities: agent.agent_capabilities || [],
            agentMetadata: agent.agent_metadata || {},
            agentEndpoint: agent.agent_endpoint,
            agentCallbackUrl: agent.agent_callback_url,
            createdAt: agent.created_at,
            updatedAt: agent.updated_at
        });
    } catch (err) {
        logger.error({ err }, 'Failed to get agent');
        res.status(500).json(createProblem({
            type: 'https://koshi.ryopc.org/problems/internal-error',
            title: 'Internal Server Error',
            status: 500,
            instance: req.path
        }));
    }
});

// ============================================================================
// GET /api/agents/{username}/card — A2A Agent Card
// ============================================================================
router.get('/api/agents/:username/card', optionalAuth, async (req, res) => {
    // Delegate to the well-known handler logic
    req.query.username = req.params.username;
    // Reuse the same logic by calling the handler
    // For now, redirect to the well-known endpoint
    res.redirect(307, `/.well-known/agent.json?username=${encodeURIComponent(req.params.username)}`);
});

export default router;