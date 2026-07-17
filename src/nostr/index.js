// ============================================================================
// koshi – Terminal-Native Decentralized SNS v2.0.2
// Nostr Protocol Integration
// License: MIT
// ============================================================================
// Bridges koshi with the Nostr protocol. Users can:
//   - Generate/import Nostr keys (nsec/npub)
//   - Push koshi posts to Nostr relays as kind 1 events
//   - Pull Nostr events from relays into koshi
//   - Cross-post between koshi board and Nostr
//
// Dependencies:
//   nostr-tools v2.23+ — Pure JS Nostr implementation
//   @noble/curves       — secp256k1 for schnorr signatures
// ============================================================================

import {
    generateSecretKey,
    getPublicKey,
    finalizeEvent,
    verifyEvent,
    SimplePool,
    nip19,
    kinds,
} from 'nostr-tools';

import { loadConfig, saveConfig, getActiveAccount } from '../config/config.js';
import { bytesToHex, hexToBytes } from '../auth/utils.js';
import { logger } from '../logger.js';

// ============================================================================
// Constants
// ============================================================================
const DEFAULT_RELAYS = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social',
];

const KOSHI_NOSTR_TAG = ['k', 'koshi']; // Custom tag marking koshi-sourced events

let _pool = null;

/**
 * Get or create the SimplePool singleton.
 */
function getPool() {
    if (!_pool) {
        _pool = new SimplePool();
    }
    return _pool;
}

/**
 * Get the Nostr config for the active account.
 * Returns null if not configured.
 */
export function getNostrConfigFromActive() {
    const config = loadConfig();
    const acct = getActiveAccount(config);
    if (!acct) return null;
    return {
        nsec: acct.nostr?.nsec || null,
        npub: acct.nostr?.npub || null,
        relays: acct.nostr?.relays || [...DEFAULT_RELAYS],
        lastPushAt: acct.nostr?.lastPushAt || null,
        lastPullAt: acct.nostr?.lastPullAt || null,
    };
}

/**
 * Set the Nostr config for the active account.
 */
export async function setNostrConfigForActive(nostrConfig) {
    const config = loadConfig();
    const acct = getActiveAccount(config);
    if (!acct) throw new Error('No active account. Login first.');
    acct.nostr = {
        nsec: nostrConfig.nsec || null,
        npub: nostrConfig.npub || null,
        relays: nostrConfig.relays || [...DEFAULT_RELAYS],
        lastPushAt: nostrConfig.lastPushAt || null,
        lastPullAt: nostrConfig.lastPullAt || null,
    };
    await saveConfig(config);
}

// ============================================================================
// Key Management
// ============================================================================

/**
 * Generate a new Nostr keypair.
 *
 * @returns {{ nsec: string, npub: string, hexSecret: string, hexPublic: string }}
 */
export function generateNostrKeypair() {
    const secretKey = generateSecretKey(); // Uint8Array (32 bytes)
    const publicKey = getPublicKey(secretKey); // hex string

    const nsec = nip19.nsecEncode(secretKey);
    const npub = nip19.npubEncode(publicKey);

    return {
        nsec,
        npub,
        hexSecret: bytesToHex(secretKey),
        hexPublic: publicKey,
    };
}

/**
 * Import an existing Nostr key from nsec or hex secret key.
 *
 * @param {string} key - nsec1... or hex string
 * @returns {{ nsec: string, npub: string, hexSecret: string, hexPublic: string }}
 */
export function importNostrKey(key) {
    let secretKey;

    if (key.startsWith('nsec1')) {
        // Decode nsec
        const decoded = nip19.decode(key);
        secretKey = decoded.data; // Uint8Array
    } else if (/^[0-9a-f]{64}$/i.test(key)) {
        // Hex secret key
        secretKey = hexToBytes(key);
    } else {
        throw new Error('Invalid key format. Provide an nsec1... string or a 64-char hex key.');
    }

    const publicKey = getPublicKey(secretKey);
    const nsec = nip19.nsecEncode(secretKey);
    const npub = nip19.npubEncode(publicKey);

    return {
        nsec,
        npub,
        hexSecret: bytesToHex(secretKey),
        hexPublic: publicKey,
    };
}

/**
 * Get the hex public key from the active Nostr config.
 */
export function getActiveNostrPubkey() {
    const nc = getNostrConfigFromActive();
    if (!nc?.nsec) return null;
    try {
        const decoded = nip19.decode(nc.nsec);
        return getPublicKey(decoded.data);
    } catch {
        return null;
    }
}

/**
 * Decode nsec to hex secret key bytes.
 */
export function decodeNsec(nsec) {
    const decoded = nip19.decode(nsec);
    return decoded.data; // Uint8Array
}

// ============================================================================
// Event Creation
// ============================================================================

/**
 * Create and sign a Nostr kind 1 (short text note) event.
 *
 * @param {string} content - The text content
 * @param {Uint8Array} secretKey - 32-byte secret key
 * @param {string[][]} [extraTags] - Additional tags to include
 * @returns {object} Signed Nostr event
 */
export function createTextNote(content, secretKey, extraTags = []) {
    const tags = [
        ...extraTags,
        KOSHI_NOSTR_TAG, // Mark as koshi-sourced
    ];

    const eventTemplate = {
        kind: kinds.ShortTextNote,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
    };

    return finalizeEvent(eventTemplate, secretKey);
}

/**
 * Create a Nostr event from a koshi post.
 *
 * @param {object} post - Koshi post { id, content, author, createdAt }
 * @param {Uint8Array} secretKey - Nostr secret key
 * @returns {object} Signed Nostr event
 */
export function createKoshiPostEvent(post, secretKey) {
    const tags = [
        KOSHI_NOSTR_TAG,
        ['d', post.id], // koshi post ID as identifier
    ];

    if (post.author?.username) {
        tags.push(['koshi_user', post.author.username]);
    }

    const content = post.content || '';
    const eventTemplate = {
        kind: kinds.ShortTextNote,
        created_at: Math.floor(new Date(post.createdAt || Date.now()).getTime() / 1000),
        tags,
        content,
    };

    return finalizeEvent(eventTemplate, secretKey);
}

// ============================================================================
// Publishing
// ============================================================================

/**
 * Publish a Nostr event to specified relays.
 *
 * @param {object} event - Signed Nostr event
 * @param {string[]} relayUrls - List of relay URLs
 * @returns {Promise<{ url: string, ok: boolean, reason?: string }[]>}
 */
export async function publishEvent(event, relayUrls) {
    const pool = getPool();
    const results = [];

    const promises = relayUrls.map(async (url) => {
        try {
            const reason = await pool.publish([url], event);
            results.push({ url, ok: true, reason: reason?.[0] });
        } catch (err) {
            logger.warn({ url, err: err.message }, 'Nostr publish failed');
            results.push({ url, ok: false, reason: err.message });
        }
    });

    await Promise.allSettled(promises);
    return results;
}

/**
 * Push koshi posts from the local feed to Nostr relays.
 *
 * @param {object[]} posts - Array of koshi posts
 * @param {Uint8Array} [secretKey] - Nostr secret key (defaults to active config)
 * @param {string[]} [relayUrls] - Relays to push to (defaults to active config)
 * @returns {Promise<{ published: number, results: object[] }>}
 */
export async function pushPostsToNostr(posts, secretKey, relayUrls) {
    // Resolve key and relays from config if not provided
    if (!secretKey || !relayUrls) {
        const nc = getNostrConfigFromActive();
        if (!nc?.nsec) throw new Error('Nostr not configured. Run: kb nostr key generate');
        if (!secretKey) secretKey = decodeNsec(nc.nsec);
        if (!relayUrls) relayUrls = nc.relays || DEFAULT_RELAYS;
    }

    const results = [];
    let published = 0;

    for (const post of posts) {
        const event = createKoshiPostEvent(post, secretKey);
        const pubResults = await publishEvent(event, relayUrls);
        const ok = pubResults.some((r) => r.ok);

        results.push({ post: post.id, eventId: event.id, ok, pubResults });

        if (ok) published++;
    }

    // Update lastPushAt timestamp
    try {
        const nc = getNostrConfigFromActive();
        if (nc) {
            nc.lastPushAt = new Date().toISOString();
            await setNostrConfigForActive(nc);
        }
    } catch {
        // best effort
    }

    return { published, results };
}

// ============================================================================
// Pulling
// ============================================================================

/**
 * Pull Nostr events from relays and convert to koshi post format.
 *
 * @param {number} [limit=50] - Max events to fetch per relay
 * @param {Uint8Array} [secretKey] - Nostr secret key (to filter by our pubkey)
 * @param {string[]} [relayUrls] - Relays to pull from
 * @returns {Promise<{ posts: object[], total: number }>}
 */
export async function pullPostsFromNostr(limit = 50, secretKey, relayUrls) {
    // Resolve from config if not provided
    if (!relayUrls) {
        const nc = getNostrConfigFromActive();
        relayUrls = nc?.relays || DEFAULT_RELAYS;
    }

    // Determine which pubkey to filter by
    let authors = undefined;
    if (secretKey) {
        authors = [getPublicKey(secretKey)];
    } else {
        const nc = getNostrConfigFromActive();
        if (nc?.nsec) {
            try {
                const decoded = nip19.decode(nc.nsec);
                authors = [getPublicKey(decoded.data)];
            } catch {
                // no key available
            }
        }
    }

    const pool = getPool();

    const filter = {
        kinds: [kinds.ShortTextNote], // kind 1 only
        ...(authors ? { authors } : {}),
        limit,
    };

    // Add koshi tag filter to only get koshi-sourced events
    // But also get events without the tag (general Nostr posts)
    const koshiFilter = {
        kinds: [kinds.ShortTextNote],
        '#k': ['koshi'],
        ...(authors ? { authors } : {}),
        limit,
    };

    try {
        // Try to get koshi-tagged events first, then general
        let events = [];

        try {
            const koshiEvents = await pool.querySync(relayUrls, koshiFilter);
            events.push(...koshiEvents);
        } catch (err) {
            logger.warn({ err: err.message }, 'Nostr koshi-filter query failed (non-critical)');
        }

        // Get remaining events to fill limit
        const remaining = limit - events.length;
        if (remaining > 0) {
            try {
                const generalFilter = { ...filter, limit: remaining + 20 };
                const generalEvents = await pool.querySync(relayUrls, generalFilter);
                // Deduplicate
                const existingIds = new Set(events.map((e) => e.id));
                for (const ev of generalEvents) {
                    if (!existingIds.has(ev.id)) {
                        events.push(ev);
                        existingIds.add(ev.id);
                    }
                }
            } catch (err) {
                logger.warn({ err: err.message }, 'Nostr general-filter query failed (non-critical)');
            }
        }

        // Sort by created_at descending (newest first)
        events.sort((a, b) => b.created_at - a.created_at);

        // Convert to koshi post format
        const posts = events.map((ev) => ({
            id: ev.id,
            content: ev.content,
            createdAt: new Date(ev.created_at * 1000).toISOString(),
            author: {
                username: ev.pubkey ? `nostr:${ev.pubkey.slice(0, 8)}` : 'nostr:unknown',
                displayName: null,
                npub: ev.pubkey ? nip19.npubEncode(ev.pubkey) : null,
            },
            signature: ev.sig,
            nostr: true, // Mark as Nostr-originated
            tags: ev.tags,
        }));

        // Update lastPullAt timestamp
        try {
            const nc = getNostrConfigFromActive();
            if (nc) {
                nc.lastPullAt = new Date().toISOString();
                await setNostrConfigForActive(nc);
            }
        } catch {
            // best effort
        }

        return { posts, total: posts.length };
    } catch (err) {
        logger.error({ err }, 'Nostr pull failed');
        throw new Error(`Failed to pull from Nostr: ${err.message}`);
    }
}

/**
 * Get Nostr profile metadata (kind 0) for a given pubkey.
 *
 * @param {string} pubkey - Hex public key
 * @param {string[]} [relayUrls]
 * @returns {Promise<object|null>}
 */
export async function getNostrProfile(pubkey, relayUrls) {
    if (!relayUrls) {
        const nc = getNostrConfigFromActive();
        relayUrls = nc?.relays || DEFAULT_RELAYS;
    }

    const pool = getPool();

    try {
        const event = await pool.get(relayUrls, {
            kinds: [kinds.Metadata],
            authors: [pubkey],
        });

        if (!event) return null;

        const metadata = JSON.parse(event.content);
        return {
            name: metadata.name || null,
            displayName: metadata.display_name || metadata.displayName || null,
            about: metadata.about || null,
            picture: metadata.picture || null,
            npub: nip19.npubEncode(pubkey),
        };
    } catch {
        return null;
    }
}

// ============================================================================
// Relay Management
// ============================================================================

/**
 * Get the list of configured relays for the active account.
 */
export function getRelays() {
    const nc = getNostrConfigFromActive();
    return nc?.relays || [...DEFAULT_RELAYS];
}

/**
 * Add a relay to the active account's relay list.
 */
export async function addRelay(url) {
    const nc = getNostrConfigFromActive();
    if (!nc) throw new Error('Nostr not configured. Generate keys first.');
    const normalized = url.replace(/\/+$/, '');
    if (!nc.relays.includes(normalized)) {
        nc.relays.push(normalized);
        await setNostrConfigForActive(nc);
    }
}

/**
 * Remove a relay from the active account's relay list.
 */
export async function removeRelay(url) {
    const nc = getNostrConfigFromActive();
    if (!nc) throw new Error('Nostr not configured.');
    nc.relays = nc.relays.filter((r) => r !== url);
    await setNostrConfigForActive(nc);
}

/**
 * Test relay connectivity.
 *
 * @param {string} url - Relay URL
 * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
 */
export async function testRelay(url) {
    const pool = getPool();
    const start = Date.now();

    try {
        const relay = await pool.ensureRelay(url, { connectionTimeout: 5000 });
        const latency = Date.now() - start;

        // Quick check: query for 1 event
        try {
            await pool.querySync([url], { kinds: [1], limit: 1 });
        } catch {
            // Even if query fails (empty), connection is OK
        }

        return { ok: true, latencyMs: latency };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Close all relay connections (cleanup).
 */
export function closeAll() {
    if (_pool) {
        try {
            _pool.destroy();
        } catch {
            // best effort
        }
        _pool = null;
    }
}

// ============================================================================
// Export
// ============================================================================
export default {
    generateNostrKeypair,
    importNostrKey,
    getNostrConfigFromActive,
    setNostrConfigForActive,
    getActiveNostrPubkey,
    createTextNote,
    createKoshiPostEvent,
    publishEvent,
    pushPostsToNostr,
    pullPostsFromNostr,
    getNostrProfile,
    getRelays,
    addRelay,
    removeRelay,
    testRelay,
    closeAll,
    DEFAULT_RELAYS,
};
