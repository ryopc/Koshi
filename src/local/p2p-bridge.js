// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// P2P Sync Bridge for Local SQLite
// License: MIT
// ============================================================================
// Bridges the P2P module with the local SQLite database.
// When running in local mode, this module:
//   1. Injects local posts/DMs into P2P for sharing with peers
//   2. Receives posts/DMs from P2P peers and stores them locally
//   3. Prevents duplicate entries via ID checks
// ============================================================================

import { logger } from '../logger.js';
import { posts, dms, users } from './db.js';

let _initialized = false;
let _unsubscribe = null;

/**
 * Initialize the P2P sync bridge.
 *
 * @param {object} p2pModule - The P2P module (src/p2p/index.js)
 */
export async function initP2PBridge(p2pModule) {
    if (_initialized) return;

    // Only bridge if P2P is ready
    if (!p2pModule.isReady()) {
        logger.info('P2P-Bridge: P2P not ready, skipping bridge init');
        return false;
    }

    logger.info('P2P-Bridge: Initializing sync bridge');

    // ---- Outgoing sync: periodically push local posts/DMs to P2P ----
    const syncInterval = setInterval(async () => {
        try {
            await syncLocalToP2P(p2pModule);
        } catch (err) {
            logger.warn({ err: err.message }, 'P2P-Bridge: Sync to P2P failed');
        }
    }, 30_000); // Every 30 seconds

    _unsubscribe = () => {
        clearInterval(syncInterval);
    };

    // Do an initial sync
    await syncLocalToP2P(p2pModule);

    _initialized = true;
    logger.info('P2P-Bridge: Initialized successfully');
    return true;
}

/**
 * Sync local data to P2P peers.
 */
async function syncLocalToP2P(p2pModule) {
    // Push local posts that haven't been synced yet
    const localPosts = await posts.getAll();
    for (const post of localPosts) {
        if (post.source === 'local' || post.source === 'p2p') {
            // Check if already in P2P
            const p2pPosts = await p2pModule.getPosts();
            const alreadyExists = p2pPosts.some(p => p.id === post.id);
            if (!alreadyExists) {
                await p2pModule.appendPost({
                    id: post.id,
                    content: post.content,
                    author: { username: post.author_username },
                    signature: post.signature,
                    createdAt: post.created_at,
                });
            }
        }
    }

    // Pull P2P posts into local DB
    const p2pPosts = await p2pModule.getPosts();
    for (const p2pPost of p2pPosts) {
        const exists = await posts.exists(p2pPost.id);
        if (!exists) {
            // Try to find the author locally, or create a placeholder
            let authorId = null;
            const authorUser = await users.findByUsername(p2pPost.author?.username);
            if (authorUser) {
                authorId = authorUser.id;
            }

            if (authorId) {
                await posts.create({
                    id: p2pPost.id,
                    authorId,
                    content: p2pPost.content,
                    signature: p2pPost.signature || '',
                    source: 'p2p',
                });
            }
        }
    }

    // Pull P2P DMs into local DB
    const p2pDMs = await p2pModule.getDMs();
    for (const p2pDM of p2pDMs) {
        const exists = await dms.exists(p2pDM.id);
        if (!exists) {
            const senderUser = await users.findByUsername(p2pDM.fromUsername || p2pDM.from?.username);
            const recipientUser = await users.findByUsername(p2pDM.toUsername || p2pDM.to?.username);
            if (senderUser && recipientUser) {
                await dms.send({
                    id: p2pDM.id,
                    senderId: senderUser.id,
                    recipientId: recipientUser.id,
                    content: p2pDM.content,
                    signature: p2pDM.signature || '',
                    source: 'p2p',
                });
            }
        }
    }
}

/**
 * Append a post from CLI directly and broadcast to P2P.
 */
export async function appendPostWithP2P(p2pModule, postData) {
    const result = await posts.create({
        authorId: postData.authorId,
        content: postData.content,
        signature: postData.signature,
    });

    // Try to broadcast to P2P
    try {
        if (p2pModule && p2pModule.isReady()) {
            await p2pModule.appendPost({
                id: result.id,
                content: postData.content,
                author: { username: postData.authorUsername },
                signature: postData.signature,
                createdAt: new Date().toISOString(),
            });
        }
    } catch (err) {
        logger.warn({ err: err.message }, 'P2P-Bridge: Failed to broadcast post');
    }

    return result;
}

/**
 * Append a DM from CLI and broadcast to P2P.
 */
export async function appendDMWithP2P(p2pModule, dmData) {
    const result = await dms.send({
        senderId: dmData.senderId,
        recipientId: dmData.recipientId,
        content: dmData.content,
        signature: dmData.signature,
    });

    // Try to broadcast to P2P
    try {
        if (p2pModule && p2pModule.isReady()) {
            await p2pModule.appendDM({
                id: result.id,
                content: dmData.content,
                fromUsername: dmData.fromUsername,
                toUsername: dmData.toUsername,
                signature: dmData.signature,
                createdAt: new Date().toISOString(),
            });
        }
    } catch (err) {
        logger.warn({ err: err.message }, 'P2P-Bridge: Failed to broadcast DM');
    }

    return result;
}

/**
 * Stop the P2P sync bridge.
 */
export async function closeP2PBridge() {
    if (_unsubscribe) {
        _unsubscribe();
        _unsubscribe = null;
    }
    _initialized = false;
    logger.info('P2P-Bridge: Closed');
}

export default {
    initP2PBridge,
    closeP2PBridge,
    appendPostWithP2P,
    appendDMWithP2P,
};
