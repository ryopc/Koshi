// ============================================================================
// koshi – Terminal-Native Decentralized SNS v3.0.0
// P2P Sync Bridge for Local SQLite (serverless mesh)
// License: MIT
// ============================================================================
// Bridges the P2P module with the local SQLite database. In v3 the bridge is
// part of the default runtime, not an optional extra:
//   1. Injects local posts/DMs/profiles into P2P for sharing with the mesh
//   2. Receives posts/DMs/profiles from peers and stores them locally
//   3. Upserts peer profiles so follow/search/DM work without a registry
//   4. Prevents duplicate entries via ID checks
// ============================================================================

import { logger } from '../logger.js';
import { posts, dms, users } from './db.js';
import { loadConfig, getActiveAccount } from '../config/config.js';

let _initialized = false;
let _p2p = null;
let _unsubscribe = null;
let _interval = null;

/**
 * Initialize the P2P sync bridge.
 *
 * @param {object} p2pModule - The P2P module (src/p2p/index.js)
 */
export async function initP2PBridge(p2pModule) {
    if (_initialized) {
        _p2p = p2pModule;
        return true;
    }
    if (!p2pModule?.isReady()) {
        logger.info('P2P-Bridge: P2P not ready, skipping bridge init');
        return false;
    }

    logger.info('P2P-Bridge: Initializing sync bridge');
    _p2p = p2pModule;

    // Realtime: whenever the mesh delivers new data, merge it into SQLite
    _unsubscribe = _p2p.subscribe(async () => {
        try {
            await syncP2PToLocal();
        } catch (err) {
            logger.warn({ err: err.message }, 'P2P-Bridge: Live sync failed');
        }
    });

    // Periodic two-way sync (bounded by dedupe checks)
    _interval = setInterval(async () => {
        try {
            // Re-read cores first so fresh blocks from peers land in the cache
            await _p2p.refresh();
            await syncLocalToP2P();
            await syncP2PToLocal();
        } catch (err) {
            logger.warn({ err: err.message }, 'P2P-Bridge: Periodic sync failed');
        }
    }, 15_000);

    // Initial sync
    try {
        await announceAllProfiles();
        await _p2p.refresh();
        await syncLocalToP2P();
        await syncP2PToLocal();
    } catch (err) {
        logger.warn({ err: err.message }, 'P2P-Bridge: Initial sync failed');
    }

    _initialized = true;
    logger.info('P2P-Bridge: Initialized successfully');
    return true;
}

// ============================================================================
// Local → P2P
// ============================================================================

/**
 * Push local users' profiles (accounts in config) to the mesh.
 */
export async function announceAllProfiles() {
    if (!_p2p?.isReady()) return;
    const config = loadConfig();
    for (const acct of Object.values(config.accounts || {})) {
        if (!acct.username || !acct.publicKey) continue;
        try {
            await _p2p.announceProfile({
                username: acct.username,
                publicKey: acct.publicKey,
                displayName: acct.displayName || null,
                bio: acct.bio || null,
                avatarUrl: acct.avatarUrl || null,
            });
        } catch { /* best effort */ }
    }
}

/**
 * Push local posts/DMs that haven't reached the mesh yet.
 */
async function syncLocalToP2P() {
    if (!_p2p?.isReady()) return;

    // Posts
    const localPosts = await posts.getAll();
    for (const post of localPosts) {
        const already = (await _p2p.getPosts()).some((p) => p.id === post.id);
        if (already) continue;
        try {
            await _p2p.appendPost({
                id: post.id,
                content: post.content,
                username: post.author_username,
                authorPubkey: await getPubkeyForUser(post.author_username),
                displayName: null,
                signature: post.signature,
                createdAt: post.created_at,
            });
        } catch { /* best effort */ }
    }

    // DMs (encrypted at rest via the P2P module)
    const localDMs = await dms.getAll();
    for (const dm of localDMs) {
        const already = (await _p2p.getDMs()).some((d) => d.id === dm.id);
        if (already) continue;
        const senderPubkey = await getPubkeyForUser(dm.sender_username);
        const recipientPubkey = await getPubkeyForUser(dm.recipient_username);
        const senderSecret = await getSecretKeyForUser(dm.sender_username);
        if (!senderPubkey || !recipientPubkey || !senderSecret) continue;
        try {
            await _p2p.appendDM({
                id: dm.id,
                content: dm.content,
                fromUsername: dm.sender_username,
                fromPubkey: senderPubkey,
                toUsername: dm.recipient_username,
                toPubkey: recipientPubkey,
                signature: dm.signature,
                createdAt: dm.created_at,
                secretKey: senderSecret,
            });
        } catch { /* best effort */ }
    }
}

// ============================================================================
// P2P → Local
// ============================================================================

/**
 * Merge everything from the mesh into the local SQLite database.
 */
async function syncP2PToLocal() {
    if (!_p2p?.isReady()) return;

    // Profiles → users table (enables follow/search without a registry)
    const profiles = await _p2p.getProfiles();
    for (const profile of profiles) {
        if (!profile.username || !profile.pubkey) continue;
        try {
            await users.upsertFromP2P({
                username: profile.username,
                publicKey: profile.pubkey,
                displayName: profile.displayName,
                bio: profile.bio,
                avatarUrl: profile.avatarUrl,
            });
        } catch { /* best effort */ }
    }

    // Posts → kb_posts
    const p2pPosts = await _p2p.getPosts();
    for (const post of p2pPosts) {
        if (await posts.exists(post.id)) continue;
        let authorId = null;
        if (post.authorPubkey) {
            const u = await users.findByPublicKey(post.authorPubkey);
            if (u) authorId = u.id;
        }
        if (!authorId && post.username) {
            const u = await users.findByUsername(post.username);
            if (u) authorId = u.id;
        }
        if (authorId) {
            await posts.create({
                id: post.id,
                authorId,
                content: post.content,
                signature: post.signature || '',
                source: 'p2p',
            });
        }
    }

    // DMs → dms table (only decryptable ones — we can read ours)
    const p2pDMs = await _p2p.getDMs();
    for (const dm of p2pDMs) {
        if (await dms.exists(dm.id)) continue;
        if (!dm.content) continue; // cannot decrypt → skip
        const sender = await users.findByPublicKey(dm.fromPubkey || '');
        const recipient = await users.findByPublicKey(dm.toPubkey || '');
        if (!sender || !recipient) continue;
        await dms.send({
            id: dm.id,
            senderId: sender.id,
            recipientId: recipient.id,
            content: dm.content,
            signature: dm.signature || '',
            source: 'p2p',
        });
    }
}

// ============================================================================
// Immediate broadcast helpers (called by the local API on create)
// ============================================================================

/**
 * Broadcast a freshly created post to the mesh immediately.
 */
export async function broadcastPost(postData) {
    if (!_p2p?.isReady()) return;
    try {
        await _p2p.appendPost(postData);
    } catch (err) {
        logger.warn({ err: err.message }, 'P2P-Bridge: Post broadcast failed');
    }
}

/**
 * Broadcast a freshly created DM to the mesh immediately (encrypted).
 */
export async function broadcastDM(dmData) {
    if (!_p2p?.isReady()) return;
    try {
        await _p2p.appendDM(dmData);
    } catch (err) {
        logger.warn({ err: err.message }, 'P2P-Bridge: DM broadcast failed');
    }
}

/**
 * Announce a profile update to the mesh immediately.
 */
export async function broadcastProfile(profile) {
    if (!_p2p?.isReady()) return;
    try {
        await _p2p.announceProfile(profile);
    } catch (err) {
        logger.warn({ err: err.message }, 'P2P-Bridge: Profile broadcast failed');
    }
}

// ============================================================================
// Helpers
// ============================================================================

async function getPubkeyForUser(username) {
    if (!username) return null;
    const config = loadConfig();
    const acct = config.accounts?.[username];
    if (acct?.publicKey) return acct.publicKey;
    // Fall back to local DB (peer profiles)
    const row = await users.findByUsername(username);
    return row?.public_key || null;
}

async function getSecretKeyForUser(username) {
    if (!username) return null;
    const config = loadConfig();
    return config.accounts?.[username]?.secretKey || null;
}

/**
 * Stop the P2P sync bridge.
 */
export async function closeP2PBridge() {
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    if (_interval) { clearInterval(_interval); _interval = null; }
    _initialized = false;
    _p2p = null;
    logger.info('P2P-Bridge: Closed');
}

export default {
    initP2PBridge,
    closeP2PBridge,
    announceAllProfiles,
    broadcastPost,
    broadcastDM,
    broadcastProfile,
};
