// ============================================================================
// koshi – Terminal-Native Decentralized SNS v2.0.2
// P2P Sync Module (hypercore + corestore + hyperswarm)
// License: MIT
// ============================================================================
// Peer-to-peer data synchronization using the Hypercore protocol stack.
//
// Architecture:
//   - Corestore manages a directory of Hypercores (append-only logs)
//   - Each data type gets its own named core: "posts", "dms", "profile"
//   - Hyperswarm handles peer discovery via DHT + NAT traversal
//   - Discovery topic is derived from the user's ed25519 public key
//   - When peers connect, all cores are replicated bidirectionally
//   - New posts/DMs are appended locally and automatically synced to peers
//
// Usage:
//   import { initP2PNode, closeP2PNode, appendPost, appendDM, ... } from '../p2p/index.js';
//   await initP2PNode();           // Start the P2P node
//   await appendPost(postObj);     // Share a post via P2P
//   const posts = await getPosts(); // Read synced posts
//   await closeP2PNode();          // Graceful shutdown
//
// Dependencies:
//   hypercore@10  — Append-only log with Merkle tree verification
//   corestore@7   — Hypercore factory (manages multiple cores)
//   hyperswarm    — P2P network discovery (DHT + hole-punching)
//   b4a           — Buffer/encoding utilities
// ============================================================================

import { loadConfig, getActiveAccount, getP2PConfig, setP2PConfig } from '../config/config.js';
import { bytesToHex, hexToBytes } from '../auth/utils.js';
import { logger } from '../logger.js';
import b4a from 'b4a';

// Dynamic imports (loaded on demand)
let HypercoreProto = null;
let CorestoreProto = null;
let HyperswarmProto = null;

async function ensureDeps() {
    if (!HypercoreProto) {
        const mod = await import('hypercore');
        HypercoreProto = mod.default;
    }
    if (!CorestoreProto) {
        const mod = await import('corestore');
        CorestoreProto = mod.default;
    }
    if (!HyperswarmProto) {
        const mod = await import('hyperswarm');
        HyperswarmProto = mod.default;
    }
}

// ============================================================================
// Module state
// ============================================================================
let _store = null;
let _swarm = null;
let _cores = {};       // { posts: Hypercore, dms: Hypercore, profile: Hypercore }
let _node = null;
let _ready = false;
let _initializing = false;
let _discoveryKey = null;

// Cached data (in-memory copies for quick access)
let _cachedPosts = [];
let _cachedDMs = [];

// ============================================================================
// P2P Node lifecycle
// ============================================================================

/**
 * Initialize the P2P node.
 *
 * Sets up:
 *   - Corestore (local storage of append-only logs)
 *   - Hypercores for posts, DMs, and profile data
 *   - Hyperswarm for peer discovery and connection
 *
 * @param {object} [options]
 * @param {string} [options.corestorePath] - Override storage path
 * @param {number} [options.port] - Listen port (0 = random)
 * @returns {Promise<boolean>}
 */
export async function initP2PNode(options = {}) {
    if (_ready) return true;
    if (_initializing) {
        logger.info('P2P: Already initializing...');
        return false;
    }

    _initializing = true;

    try {
        await ensureDeps();

        const config = loadConfig();
        const p2p = { ...getP2PConfig(config), ...options };
        const acct = getActiveAccount(config);

        if (!acct) {
            logger.warn('P2P: No active account. Cannot start P2P node.');
            _initializing = false;
            return false;
        }

        // Derive discovery key from user's ed25519 public key (first 32 bytes)
        const pubkey = acct.publicKey;
        if (!pubkey) {
            logger.warn('P2P: No public key for active account.');
            _initializing = false;
            return false;
        }

        // Use sha256 of public key as discovery topic (32 bytes)
        const { createHash } = await import('node:crypto');
        const topicHash = createHash('sha256').update(b4a.from(pubkey, 'hex')).digest();
        _discoveryKey = topicHash;

        // 1. Initialize Corestore
        logger.info({ corestorePath: p2p.corestorePath }, 'P2P: Initializing Corestore');
        _store = new CorestoreProto(p2p.corestorePath);

        // 2. Create named cores
        logger.info('P2P: Creating data cores...');
        const postCore = _store.get({ name: 'posts' });
        const dmCore = _store.get({ name: 'dms' });
        const profileCore = _store.get({ name: 'profile' });

        await Promise.all([
            postCore.ready(),
            dmCore.ready(),
            profileCore.ready(),
        ]);

        _cores = { posts: postCore, dms: dmCore, profile: profileCore };

        logger.info({
            postCoreKey: bytesToHex(postCore.key).slice(0, 16) + '...',
            dmCoreKey: bytesToHex(dmCore.key).slice(0, 16) + '...',
            postLength: postCore.length,
            dmLength: dmCore.length,
        }, 'P2P: Cores ready');

        // 3. Load cached data from cores
        await reloadCaches();

        // 4. Initialize Hyperswarm
        logger.info({ port: p2p.port }, 'P2P: Initializing Hyperswarm');
        _swarm = new Hyperswarm();            // Handle peer connections — replicate all cores
            _swarm.on('connection', (conn, info) => {
                const peer = info.client ? 'client' : 'server';
                const remoteAddr = info.remoteAddress || info.publicKey || 'unknown';
                logger.info({ peer, remote: remoteAddr }, 'P2P: Peer connected');

                // Replicate the entire corestore (all cores) — live mode for continuous sync
                const replicateStream = _store.replicate(info.client, { live: true });
                conn.pipe(replicateStream).pipe(conn);

                conn.on('error', (err) => {
                    logger.warn({ err: err.message }, 'P2P: Peer connection error');
                });

                conn.on('close', () => {
                    logger.info({ remote: remoteAddr }, 'P2P: Peer connection closed');
                    // Reload caches after peer disconnects (may have synced new data)
                    reloadCaches().catch((err) => logger.warn({ err: err.message }, 'P2P: Cache reload after close failed'));
                });

                // Reload caches when replication stream finishes or closes
                const onReplEnd = async () => {
                    logger.debug('P2P: Replication stream event, reloading caches...');
                    try {
                        await reloadCaches();
                    } catch (err) {
                        logger.warn({ err: err.message }, 'P2P: Cache reload after replication failed');
                    }
                };
                replicateStream.on('end', onReplEnd);
                replicateStream.on('close', onReplEnd);

                replicateStream.on('error', (err) => {
                    logger.warn({ err: err.message }, 'P2P: Replication stream error');
                });
            });

            // Log swarm-level events
            _swarm.on('disconnection', (conn, info) => {
                logger.debug({ remote: info.remoteAddress || 'unknown' }, 'P2P: Swarm disconnection');
            });

        // 5. Join the discovery topic
        _swarm.join(_discoveryKey, { server: true, client: true });
        await _swarm.flush();

        _ready = true;
        _initializing = false;
        _node = {
            status: 'running',
            username: acct.username,
            corestorePath: p2p.corestorePath,
            port: p2p.port,
            discoveryKey: bytesToHex(_discoveryKey).slice(0, 16) + '...',
            postCount: postCore.length,
            dmCount: dmCore.length,
            connected: true,
        };

        logger.info({
            username: acct.username,
            discoveryKey: _node.discoveryKey,
            posts: postCore.length,
            dms: dmCore.length,
        }, 'P2P: Node initialized successfully');

        return true;
    } catch (err) {
        logger.error({ err: err.message, stack: err.stack }, 'P2P: Failed to initialize node');
        _initializing = false;

        // Cleanup on failure
        await cleanup();
        return false;
    }
}

/**
 * Reload in-memory caches from hypercores.
 * Uses batched reads (chunks of 10) for performance.
 */
async function reloadCaches() {
    const posts = [];
    const dms = [];

    const CHUNK = 10;

    if (_cores.posts) {
        const len = _cores.posts.length;
        for (let start = 0; start < len; start += CHUNK) {
            const end = Math.min(start + CHUNK, len);
            const promises = [];
            for (let i = start; i < end; i++) {
                promises.push(
                    _cores.posts.get(i).then(block => block ? JSON.parse(b4a.toString(block)) : null).catch(() => null)
                );
            }
            const results = await Promise.all(promises);
            for (const r of results) {
                if (r) posts.push(r);
            }
        }
    }

    if (_cores.dms) {
        const len = _cores.dms.length;
        for (let start = 0; start < len; start += CHUNK) {
            const end = Math.min(start + CHUNK, len);
            const promises = [];
            for (let i = start; i < end; i++) {
                promises.push(
                    _cores.dms.get(i).then(block => block ? JSON.parse(b4a.toString(block)) : null).catch(() => null)
                );
            }
            const results = await Promise.all(promises);
            for (const r of results) {
                if (r) dms.push(r);
            }
        }
    }

    _cachedPosts = posts;
    _cachedDMs = dms;

    logger.debug({ posts: posts.length, dms: dms.length }, 'P2P: Caches reloaded');
}

/**
 * Gracefully shut down the P2P node.
 */
export async function closeP2PNode() {
    if (!_ready && !_swarm && !_store) return;

    logger.info('P2P: Shutting down node...');

    try {
        if (_swarm) {
            if (_discoveryKey) {
                _swarm.leave(_discoveryKey);
            }
            await _swarm.destroy();
            _swarm = null;
        }

        if (_store) {
            await _store.close();
            _store = null;
        }
    } catch (err) {
        logger.warn({ err: err.message }, 'P2P: Error during shutdown');
    }

    _cores = {};
    _cachedPosts = [];
    _cachedDMs = [];
    _ready = false;
    _node = null;
    _discoveryKey = null;

    logger.info('P2P: Node shut down');
}

async function cleanup() {
    try {
        if (_swarm) {
            await _swarm.destroy().catch(() => {});
            _swarm = null;
        }
        if (_store) {
            await _store.close().catch(() => {});
            _store = null;
        }
    } catch {}
    _cores = {};
    _cachedPosts = [];
    _cachedDMs = [];
    _node = null;
    _discoveryKey = null;
}

// ============================================================================
// Data operations
// ============================================================================

/**
 * Append a post to the P2P store and sync to peers.
 *
 * @param {object} post - Post object { id, content, author, createdAt, signature }
 * @returns {Promise<boolean>}
 */
export async function appendPost(post) {
    if (!_ready || !_cores.posts) {
        logger.warn('P2P: Not ready. Cannot append post.');
        return false;
    }

    // Avoid duplicates: check if post ID already exists
    if (_cachedPosts.some(p => p.id === post.id)) {
        logger.debug({ postId: post.id }, 'P2P: Post already synced, skipping');
        return true;
    }

    try {
        const data = b4a.from(JSON.stringify({
            id: post.id,
            content: post.content,
            username: post.author?.username || post.username || 'unknown',
            displayName: post.author?.displayName || null,
            signature: post.signature || null,
            createdAt: post.createdAt || post.timestamp || new Date().toISOString(),
            type: 'post',
        }));

        await _cores.posts.append(data);
        _cachedPosts.unshift({
            ...post,
            _p2p: true,
            _p2pIndex: _cores.posts.length - 1,
        });

        logger.debug({ postId: post.id, index: _cores.posts.length - 1 }, 'P2P: Post appended');
        return true;
    } catch (err) {
        logger.error({ err: err.message, postId: post.id }, 'P2P: Failed to append post');
        return false;
    }
}

/**
 * Append a DM to the P2P store and sync to peers.
 *
 * @param {object} dm - DM object { id, content, from, to, createdAt, signature }
 * @returns {Promise<boolean>}
 */
export async function appendDM(dm) {
    if (!_ready || !_cores.dms) {
        logger.warn('P2P: Not ready. Cannot append DM.');
        return false;
    }

    // Avoid duplicates
    if (_cachedDMs.some(d => d.id === dm.id)) {
        return true;
    }

    try {
        const data = b4a.from(JSON.stringify({
            id: dm.id,
            content: dm.content,
            fromUsername: dm.from?.username || dm.fromUsername || 'unknown',
            toUsername: dm.to?.username || dm.toUsername || 'unknown',
            signature: dm.signature || null,
            createdAt: dm.createdAt || dm.timestamp || new Date().toISOString(),
            type: 'dm',
        }));

        await _cores.dms.append(data);
        _cachedDMs.unshift({ ...dm, _p2p: true });

        logger.debug({ dmId: dm.id }, 'P2P: DM appended');
        return true;
    } catch (err) {
        logger.error({ err: err.message, dmId: dm.id }, 'P2P: Failed to append DM');
        return false;
    }
}

/**
 * Get all synced posts from the local P2P store.
 *
 * @returns {Promise<object[]>}
 */
export async function getPosts() {
    if (!_ready) return [];
    // Sort by createdAt descending (newest first)
    return [..._cachedPosts].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/**
 * Get all synced DMs from the local P2P store.
 *
 * @returns {Promise<object[]>}
 */
export async function getDMs() {
    if (!_ready) return [];
    // Sort by createdAt descending (newest first)
    return [..._cachedDMs].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/**
 * Get the number of connected peers.
 *
 * @returns {number}
 */
export function getPeerCount() {
    if (!_swarm) return 0;
    return _swarm.connections?.size || 0;
}

// ============================================================================
// Status
// ============================================================================

/**
 * Get the current P2P node status.
 *
 * @returns {{
 *   ready: boolean,
 *   status: string,
 *   posts: number,
 *   dms: number,
 *   peers: number,
 *   info: object|null
 * }}
 */
export function getP2PStatus() {
    if (!_ready) {
        return {
            ready: false,
            status: _initializing ? 'initializing' : 'stopped',
            posts: 0,
            dms: 0,
            peers: 0,
            info: null,
        };
    }

    return {
        ready: _ready,
        status: 'running',            posts: _cachedPosts.length,
            dms: _cachedDMs.length,
            peers: getPeerCount(),
            info: _node ? { ..._node, peerCount: getPeerCount(), connected: true } : null,
    };
}

/**
 * Check if the P2P node is ready.
 *
 * @returns {boolean}
 */
export function isReady() {
    return _ready;
}

// ============================================================================
// Auto-sync (called from API/WS handlers)
// ============================================================================

/**
 * Try to initialize P2P if autoSync is enabled in config.
 * Called during server startup.
 *
 * @returns {Promise<boolean>}
 */
export async function autoStart() {
    const config = loadConfig();
    const p2p = getP2PConfig(config);
    if (!p2p.autoSync) {
        logger.info('P2P: autoSync disabled, skipping auto-start');
        return false;
    }
    return initP2PNode();
}

// ============================================================================
// Export
// ============================================================================
export default {
    initP2PNode,
    closeP2PNode,
    appendPost,
    appendDM,
    getPosts,
    getDMs,
    getP2PStatus,
    getPeerCount,
    isReady,
    autoStart,
};
