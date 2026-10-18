// ============================================================================
// koshi – Terminal-Native Decentralized SNS v3.1.6
// P2P Sync Module (hypercore + corestore + hyperswarm) — Serverless Mesh
// License: MIT
// ============================================================================
// v3 redesign: P2P runs automatically as infrastructure (no manual commands).
//
// Topology:
//   - All nodes join the GLOBAL BOARD topic  → posts/profile gossip network
//   - Each account joins its OWN USER topic   → direct DM delivery
//   - On every connection, peers exchange a JSON "hello" line carrying their
//     identity (username, pubkey) and core keys, then replicate their cores.
//
// Data model (append-only logs, one core per data type per node):
//   posts core   — { type:'post' } blocks + { type:'announce' } address blocks
//   dms core     — { type:'dm' } blocks (end-to-end encrypted with nacl.box)
//   profile core — { type:'profile' } blocks (username, displayName, bio...)
//
// Reads are AGGREGATED: every node merges its own cores with the cores of all
// peers it has met (announce blocks carry the addresses).
//
// Dependencies:
//   hypercore@10 — Append-only log with Merkle tree verification
//   corestore@7  — Hypercore factory (manages multiple cores)
//   hyperswarm   — P2P network discovery (HyperDHT + hole-punching)
//   b4a          — Buffer/encoding utilities
// ============================================================================

import { loadConfig, getP2PConfig, P2P_TOPIC_BOARD, P2P_TOPIC_USER_PREFIX } from '../config/config.js';
import { bytesToHex, hexToBytes } from '../auth/utils.js';
import { encryptDMBlock, decryptDMBlock } from '../auth/dh.js';
import { verifySignature } from '../auth/ed25519.js';
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
let _cores = {};       // { posts, dms, profile } — own writable cores
let _node = null;
let _ready = false;
let _initializing = false;

// Cached aggregated data
let _cachedPosts = [];
let _cachedDMs = [];
let _cachedProfiles = [];

// Known peer cores: keyHex -> { core, pubkey, username, name }
const _peerCores = new Map();
// Read progress per core: keyHex -> last block index read
const _readOffsets = new Map();
// Peers seen this session (by pubkey) to avoid duplicate opens
const _seenPeers = new Set();

// Realtime listeners (chat / realtime feed)
const _listeners = new Set();

function emitChange() {
    for (const fn of _listeners) {
        try { fn(); } catch { /* ignore listener errors */ }
    }
}

/**
 * Re-run refresh whenever a tracked core receives new blocks.
 *
 * Critical for live replication: blocks can arrive long after the initial
 * refresh (e.g. we open a peer's core, then the peer appends). Without this,
 * refresh runs only at connect time, missing any data that lands afterwards.
 */
function trackCoreAppends(core) {
    if (!core || core._koshiTracked) return;
    core._koshiTracked = true;
    core.on('append', () => {
        refresh().catch(() => {});
    });
}

/**
 * Subscribe to data changes (new posts/DMs/profiles arrived from peers).
 * @returns {() => void} unsubscribe function
 */
export function subscribe(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

// ============================================================================
// Topic helpers (async — topics derived from well-known strings)
// ============================================================================
let _topicCache = new Map();

async function topicFor(name) {
    if (!_topicCache.has(name)) {
        const { createHash } = await import('node:crypto');
        _topicCache.set(name, createHash('sha256').update(name).digest());
    }
    return _topicCache.get(name);
}

// ============================================================================
// P2P Node lifecycle
// ============================================================================

/**
 * Initialize the P2P node.
 * Joins the global board topic plus a per-user topic for every account
 * hosted on this machine, so DMs and posts flow automatically.
 *
 * @param {object} [options]
 * @param {string} [options.corestorePath] - Override storage path
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

        // 1. Initialize Corestore
        logger.info({ corestorePath: p2p.corestorePath }, 'P2P: Initializing Corestore');
        _store = new CorestoreProto(p2p.corestorePath);

        // 2. Create own named cores
        const posts = _store.get({ name: 'posts' });
        const dms = _store.get({ name: 'dms' });
        const profile = _store.get({ name: 'profile' });
        await Promise.all([posts.ready(), dms.ready(), profile.ready()]);
        _cores = { posts, dms, profile };
        for (const core of Object.values(_cores)) trackCoreAppends(core);

        logger.info({
            postsKey: bytesToHex(posts.key).slice(0, 16) + '...',
            dmsKey: bytesToHex(dms.key).slice(0, 16) + '...',
            postsLength: posts.length,
            dmsLength: dms.length,
        }, 'P2P: Own cores ready');

        // 3. Register our own cores in the peer table (self)
        for (const [name, core] of Object.entries(_cores)) {
            const keyHex = bytesToHex(core.key);
            _peerCores.set(keyHex, { core, pubkey: null, username: null, name, self: true });
            _readOffsets.set(keyHex, 0);
        }

        // 4. Initialize Hyperswarm
        _swarm = new HyperswarmProto();
        _swarm.on('connection', handleConnection);

        _swarm.on('disconnection', (conn, info) => {
            logger.debug({ remote: info.remoteAddress || 'unknown' }, 'P2P: Swarm disconnection');
        });

        // 5. Join topics — global board + one per local account
        _swarm.join(await topicFor(P2P_TOPIC_BOARD), { server: true, client: true });
        const accounts = Object.values(config.accounts || {});
        for (const acct of accounts) {
            if (acct.publicKey) {
                _swarm.join(await topicFor(P2P_TOPIC_USER_PREFIX + acct.publicKey), { server: true, client: true });
            }
        }
        await _swarm.flush();

        _ready = true;
        _initializing = false;

        _node = {
            status: 'running',
            accounts: accounts.map((a) => a.username),
            corestorePath: p2p.corestorePath,
            postsKey: bytesToHex(posts.key),
            dmsKey: bytesToHex(dms.key),
            profileKey: bytesToHex(profile.key),
            peers: 0,
        };

        // 6. Initial refresh of aggregated data + announce ourselves
        await refresh();

        logger.info({ accounts: _node.accounts, peers: getPeerCount() }, 'P2P: Node initialized (serverless mesh)');
        return true;
    } catch (err) {
        logger.error({ err: err.message, stack: err.stack }, 'P2P: Failed to initialize node');
        _initializing = false;
        await cleanup();
        return false;
    }
}

// ============================================================================
// Swarm connection handling — hello-line framing + corestore replication
// ============================================================================

/**
 * Build the "hello" payload announcing our identity and core keys.
 */
function buildHello() {
    const config = loadConfig();
    const acct = config.accounts && config.accounts[config.activeUsername]
        ? config.accounts[config.activeUsername]
        : Object.values(config.accounts || {})[0] || null;

    return {
        v: 3,
        type: 'koshi-hello',
        username: acct?.username || null,
        pubkey: acct?.publicKey || null,
        cores: {
            posts: bytesToHex(_cores.posts.key),
            dms: bytesToHex(_cores.dms.key),
            profile: bytesToHex(_cores.profile.key),
        },
        ts: Date.now(),
    };
}

function handleConnection(conn, info) {
    const remote = info.remoteAddress || info.publicKey?.toString('hex')?.slice(0, 8) || 'unknown';
    logger.debug({ remote }, 'P2P: Peer connected');

    // Send our hello first (single JSON line)
    try {
        conn.write(Buffer.from(JSON.stringify(buildHello()) + '\n'));
    } catch { /* peer closed */ }

    // Read the peer's hello line, then start corestore replication
    let helloBuf = Buffer.alloc(0);
    let started = false;

    const onData = (chunk) => {
        if (started) return;
        const nl = chunk.indexOf(0x0a);
        if (nl === -1) {
            helloBuf = Buffer.concat([helloBuf, chunk]);
            return;
        }

        started = true;
        conn.removeListener('data', onData);

        // Parse hello (old v2 peers send protocol bytes directly — ignore)
        try {
            const hello = JSON.parse(Buffer.concat([helloBuf, chunk.slice(0, nl)]).toString());
            if (hello && hello.type === 'koshi-hello') {
                onPeerHello(hello);
            }
        } catch {
            logger.debug({ remote }, 'P2P: Peer did not send a koshi hello (legacy peer)');
        }

        // Pipe the remainder + future data into corestore replication
        const rest = chunk.slice(nl + 1);
        const repl = _store.replicate(info.client, { live: true });

        repl.on('error', (err) => logger.warn({ err: err.message }, 'P2P: Replication error'));
        repl.on('close', () => refresh().catch(() => {}));
        conn.on('error', (err) => logger.warn({ err: err.message }, 'P2P: Peer connection error'));
        conn.on('close', () => logger.debug({ remote }, 'P2P: Peer connection closed'));

        // Preserve byte order: remaining hello bytes first, then the pipe
        conn.pause();
        if (rest.length > 0) repl.write(rest);
        conn.pipe(repl).pipe(conn);
        conn.resume();

        refresh().catch(() => {});
    };

    conn.on('data', onData);
    conn.on('close', () => {
        conn.removeListener('data', onData);
        // Drop peer cores we opened via this connection? Keep them cached
        // (they may reconnect); refresh will still work from stored blocks.
    });
}

/**
 * A peer introduced itself — open its cores so corestore replicates them.
 */
async function onPeerHello(hello) {
    if (!hello?.cores) return;

    // Dedupe by pubkey (reconnect case)
    if (hello.pubkey) {
        if (_seenPeers.has(hello.pubkey)) return;
        _seenPeers.add(hello.pubkey);
    }

    for (const [name, keyHex] of Object.entries(hello.cores)) {
        if (_peerCores.has(keyHex)) continue;
        try {
            const core = _store.get({ key: Buffer.from(keyHex, 'hex') });
            await core.ready();
            _peerCores.set(keyHex, {
                core,
                pubkey: hello.pubkey || null,
                username: hello.username || null,
                name,
                self: false,
            });
            _readOffsets.set(keyHex, 0);
            trackCoreAppends(core);
            logger.debug({ name, pubkey: hello.pubkey?.slice(0, 8) }, 'P2P: Registered peer core');
        } catch (err) {
            logger.debug({ err: err.message }, 'P2P: Failed to open peer core');
        }
    }

    await refresh();
}

// ============================================================================
// Aggregated reads
// ============================================================================

/**
 * Read new blocks from a single core (own or peer) starting at its offset.
 */
async function readCore(core, keyHex) {
    const offset = _readOffsets.get(keyHex) || 0;
    const blocks = [];

    try {
        await core.update();
        const len = core.length;
        for (let i = offset; i < len; i++) {
            try {
                const buf = await core.get(i);
                if (!buf) continue;
                const parsed = JSON.parse(b4a.toString(buf));
                if (parsed && typeof parsed === 'object') blocks.push(parsed);
            } catch { /* skip unparsable / undownloaded blocks */ }
        }
        _readOffsets.set(keyHex, Math.max(offset, len));
    } catch {
        // Remote core may not have synced yet — fine
    }

    return blocks;
}

/**
 * Refresh aggregated caches from all known cores.
 * Called on connect, on close, and periodically.
 */
export async function refresh() {
    if (!_ready) return;

    const posts = [..._cachedPosts];
    const dms = [..._cachedDMs];
    const profiles = [..._cachedProfiles];
    // Snapshot OLD cache sizes BEFORE reassignment — emitChange must fire when
    // new peer data is found, so compare against the previous state.
    const prevPostsLen = _cachedPosts.length;
    const prevDMsLen = _cachedDMs.length;
    const prevProfilesLen = _cachedProfiles.length;
    const seenPostIds = new Set(posts.map((p) => p.id));
    const seenDMIds = new Set(dms.map((d) => d.id));
    const seenUsernames = new Set(profiles.map((p) => p.username));
    const newAnnounces = [];

    for (const [keyHex, entry] of _peerCores) {
        try {
            const blocks = await readCore(entry.core, keyHex);

            for (const block of blocks) {
                switch (block.type) {
                    case 'post': {
                        if (seenPostIds.has(block.id)) break;
                        seenPostIds.add(block.id);
                        posts.push({
                            id: block.id,
                            content: block.content,
                            username: block.username || 'unknown',
                            authorPubkey: block.authorPubkey || null,
                            displayName: block.displayName || null,
                            signature: block.signature || null,
                            createdAt: block.createdAt || new Date().toISOString(),
                            _p2p: true,
                        });
                        break;
                    }
                    case 'dm': {
                        if (seenDMIds.has(block.id)) break;
                        seenDMIds.add(block.id);
                        const decrypted = decryptDMFor(block);
                        dms.push({
                            id: block.id,
                            fromUsername: block.fromUsername || 'unknown',
                            fromPubkey: block.fromPubkey || null,
                            toUsername: block.toUsername || 'unknown',
                            toPubkey: block.toPubkey || null,
                            content: decrypted ?? null, // null = not decryptable
                            encrypted: decrypted ? undefined : block.encrypted,
                            signature: block.signature || null,
                            createdAt: block.createdAt || new Date().toISOString(),
                            _p2p: true,
                        });
                        break;
                    }
                    case 'profile': {
                        if (seenUsernames.has(block.username)) break;
                        seenUsernames.add(block.username);
                        profiles.push(block);
                        break;
                    }
                    case 'announce': {
                        newAnnounces.push(block);
                        break;
                    }
                    default:
                        break;
                }
            }
        } catch { /* skip broken cores */ }
    }

    // Process announce blocks: register any new cores we haven't opened yet
    for (const ann of newAnnounces) {
        for (const [name, keyHex] of Object.entries(ann.cores || {})) {
            if (_peerCores.has(keyHex) || keyHex === bytesToHex(_cores.posts.key)
                || keyHex === bytesToHex(_cores.dms.key) || keyHex === bytesToHex(_cores.profile.key)) {
                continue;
            }
            try {
                const core = _store.get({ key: Buffer.from(keyHex, 'hex') });
                _peerCores.set(keyHex, { core, pubkey: ann.pubkey || null, username: ann.username || null, name, self: false });
                _readOffsets.set(keyHex, 0);
                trackCoreAppends(core);
            } catch { /* ignore */ }
        }
    }

    _cachedPosts = posts.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    _cachedDMs = dms.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    _cachedProfiles = profiles;

    // Compare against the pre-refresh sizes (not the just-assigned arrays)
    const changed = newAnnounces.length > 0
        || posts.length !== prevPostsLen
        || dms.length !== prevDMsLen
        || profiles.length !== prevProfilesLen;
    if (changed) emitChange();
}

/**
 * Try to decrypt a DM block for any account hosted on this machine.
 * Sender can decrypt their own outgoing DMs (they know the recipient's pk).
 */
function decryptDMFor(block) {
    const config = loadConfig();
    for (const acct of Object.values(config.accounts || {})) {
        if (!acct.secretKey || !acct.publicKey) continue;
        if (block.fromPubkey === acct.publicKey || block.toPubkey === acct.publicKey) {
            const plain = decryptDMBlock(block, acct.secretKey);
            if (plain) return plain;
        }
    }
    return null;
}

// ============================================================================
// Graceful shutdown
// ============================================================================

export async function closeP2PNode() {
    if (!_ready && !_swarm && !_store) return;
    logger.info('P2P: Shutting down node...');

    try {
        if (_swarm) {
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
    _cachedProfiles = [];
    _peerCores.clear();
    _readOffsets.clear();
    _seenPeers.clear();
    _ready = false;
    _node = null;
    logger.info('P2P: Node shut down');
}

async function cleanup() {
    try {
        if (_swarm) { await _swarm.destroy().catch(() => {}); _swarm = null; }
        if (_store) { await _store.close().catch(() => {}); _store = null; }
    } catch {}
    _cores = {};
    _cachedPosts = [];
    _cachedDMs = [];
    _cachedProfiles = [];
    _peerCores.clear();
    _readOffsets.clear();
    _seenPeers.clear();
    _node = null;
}

// ============================================================================
// Data operations (writing — broadcast to the mesh)
// ============================================================================

/**
 * Append a post to the board and sync to the mesh.
 *
 * @param {object} post - { id, content, username, publicKey, displayName, signature, createdAt }
 * @returns {Promise<boolean>}
 */
export async function appendPost(post) {
    if (!_ready || !_cores.posts) {
        logger.warn('P2P: Not ready. Cannot append post.');
        return false;
    }

    const block = {
        v: 3,
        type: 'post',
        id: post.id,
        content: post.content,
        username: post.username || post.author?.username || 'unknown',
        authorPubkey: post.publicKey || post.authorPubkey || null,
        displayName: post.displayName || null,
        signature: post.signature || null,
        createdAt: post.createdAt || new Date().toISOString(),
    };

    try {
        await _cores.posts.append(b4a.from(JSON.stringify(block)));
        _cachedPosts.unshift(block);
        logger.debug({ id: block.id }, 'P2P: Post appended');
        emitChange();
        return true;
    } catch (err) {
        logger.error({ err: err.message, id: block.id }, 'P2P: Failed to append post');
        return false;
    }
}

/**
 * Append an end-to-end encrypted DM to the mesh.
 *
 * @param {object} dm - { id, content, fromUsername, fromPubkey, toUsername, toPubkey, signature, createdAt, secretKey }
 *   secretKey is the SENDER's ed25519 secret key, used for encryption.
 * @returns {Promise<boolean>}
 */
export async function appendDM(dm) {
    if (!_ready || !_cores.dms) {
        logger.warn('P2P: Not ready. Cannot append DM.');
        return false;
    }

    const { encrypted, nonce } = encryptDMBlock(dm.content, dm.secretKey, dm.toPubkey);

    const block = {
        v: 3,
        type: 'dm',
        id: dm.id,
        fromUsername: dm.fromUsername || 'unknown',
        fromPubkey: dm.fromPubkey || null,
        toUsername: dm.toUsername || 'unknown',
        toPubkey: dm.toPubkey || null,
        encrypted,
        nonce,
        signature: dm.signature || null,
        createdAt: dm.createdAt || new Date().toISOString(),
    };

    try {
        await _cores.dms.append(b4a.from(JSON.stringify(block)));
        _cachedDMs.unshift({
            ...block,
            content: dm.content, // sender sees plaintext locally
            encrypted: undefined,
        });
        logger.debug({ id: block.id, to: block.toUsername }, 'P2P: DM appended (encrypted)');
        emitChange();
        return true;
    } catch (err) {
        logger.error({ err: err.message, id: block.id }, 'P2P: Failed to append DM');
        return false;
    }
}

/**
 * Broadcast a profile update for the active account.
 *
 * @param {object} profile - { username, publicKey, displayName, bio, avatarUrl }
 * @returns {Promise<boolean>}
 */
export async function announceProfile(profile) {
    if (!_ready || !_cores.profile) return false;

    const block = {
        v: 3,
        type: 'profile',
        username: profile.username,
        pubkey: profile.publicKey,
        displayName: profile.displayName || null,
        bio: profile.bio || null,
        avatarUrl: profile.avatarUrl || null,
        updatedAt: new Date().toISOString(),
    };

    try {
        await _cores.profile.append(b4a.from(JSON.stringify(block)));
        _cachedProfiles = _cachedProfiles.filter((p) => p.username !== block.username);
        _cachedProfiles.push(block);
        logger.debug({ username: block.username }, 'P2P: Profile announced');
        emitChange();
        return true;
    } catch (err) {
        logger.error({ err: err.message }, 'P2P: Failed to announce profile');
        return false;
    }
}

/**
 * Append an announce block to our own posts core.
 * Carries our core addresses so peers can open and sync them.
 */
export async function announceSelf() {
    if (!_ready || !_cores.posts) return false;

    const config = loadConfig();
    const acct = config.accounts && config.accounts[config.activeUsername]
        ? config.accounts[config.activeUsername]
        : Object.values(config.accounts || {})[0] || null;

    const block = {
        v: 3,
        type: 'announce',
        username: acct?.username || null,
        pubkey: acct?.publicKey || null,
        cores: {
            posts: bytesToHex(_cores.posts.key),
            dms: bytesToHex(_cores.dms.key),
            profile: bytesToHex(_cores.profile.key),
        },
        createdAt: new Date().toISOString(),
    };

    try {
        // Dedupe: avoid appending a new announce every time (keep log small).
        const len = _cores.posts.length;
        for (let i = Math.max(0, len - 5); i < len; i++) {
            const buf = await _cores.posts.get(i).catch(() => null);
            if (!buf) continue;
            const parsed = JSON.parse(b4a.toString(buf));
            if (parsed?.type === 'announce') return true; // already announced
        }
        await _cores.posts.append(b4a.from(JSON.stringify(block)));
        logger.debug({ username: block.username }, 'P2P: Announce appended');
        return true;
    } catch (err) {
        logger.warn({ err: err.message }, 'P2P: Failed to append announce');
        return false;
    }
}

// ============================================================================
// Reads (aggregated)
// ============================================================================

/**
 * Get all aggregated posts (own + synced peers), newest first.
 */
export async function getPosts() {
    return [..._cachedPosts];
}

/**
 * Get all aggregated DMs (decrypted where possible), newest first.
 */
export async function getDMs() {
    return [..._cachedDMs];
}

/**
 * Get all known profiles.
 */
export async function getProfiles() {
    return [..._cachedProfiles];
}

/**
 * Get known peers (username / pubkey) met this session.
 */
export function getKnownPeers() {
    const out = [];
    for (const entry of _peerCores.values()) {
        if (entry.pubkey && !entry.self) {
            out.push({ username: entry.username, pubkey: entry.pubkey });
        }
    }
    return out;
}

/**
 * Get the number of connected peers.
 */
export function getPeerCount() {
    if (!_swarm) return 0;
    return _swarm.connections?.size || 0;
}

// ============================================================================
// Status
// ============================================================================

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
        ready: true,
        status: 'running',
        posts: _cachedPosts.length,
        dms: _cachedDMs.length,
        profiles: _cachedProfiles.length,
        peers: getPeerCount(),
        info: _node ? { ..._node, peerCount: getPeerCount(), connected: true } : null,
    };
}

export function isReady() {
    return _ready;
}

// ============================================================================
// Auto-start (P2P as infrastructure — no manual command needed)
// ============================================================================

/**
 * Start the P2P mesh automatically. Called at CLI startup.
 * Respects the p2p.autoSync setting (default: true in v3).
 */
export async function autoStart() {
    const config = loadConfig();
    const p2p = getP2PConfig(config);
    if (p2p.autoSync === false) {
        logger.info('P2P: autoSync disabled in config, skipping');
        return false;
    }
    const ok = await initP2PNode();
    if (ok) await announceSelf();
    return ok;
}

// ============================================================================
// Export
// ============================================================================
export default {
    initP2PNode,
    closeP2PNode,
    appendPost,
    appendDM,
    announceProfile,
    announceSelf,
    getPosts,
    getDMs,
    getProfiles,
    getKnownPeers,
    getP2PStatus,
    getPeerCount,
    isReady,
    autoStart,
    refresh,
    subscribe,
};
