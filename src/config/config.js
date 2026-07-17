// ============================================================================
// koshi – Terminal-Native Decentralized SNS v2.0.1
// Configuration Management (Multi-Account + Nostr + P2P)
// License: MIT
// ============================================================================
// Manages ~/.config/koshi/config.json with support for:
//   - Multi-account (existing)
//   - Nostr keys & relays (new in v2.0.0)
//   - P2P / corestore settings (new in v2.0.0)
//   - Bug fixes & stability improvements (v2.0.1)
//
// Config file format:
//   {
//     "version": "2.0.1",
//     "activeUsername": "alice",
//     "p2p": {
//       "corestorePath": "/home/user/.config/koshi/corestore",
//       "autoSync": true,
//       "port": 0
//     },
//     "accounts": {
//       "alice": {
//         "username": "alice",
//         "userId": "uuid",
//         "publicKey": "ed25519-hex",
//         "secretKey": "ed25519-hex",
//         "token": "jwt",
//         "nostr": {
//           "nsec": "nsec1...",
//           "npub": "npub1...",
//           "relays": ["wss://relay.damus.io"],
//           "lastPushAt": null,
//           "lastPullAt": null
//         }
//       }
//     }
//   }
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ============================================================================
// Constants
// ============================================================================
const CONFIG_DIR = join(homedir(), '.config', 'koshi');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const SNSRC_FILE = join(homedir(), '.snsrc');
const DEFAULT_CORESTORE_DIR = join(CONFIG_DIR, 'corestore');
const KOSHI_VERSION = '2.0.1';

// ============================================================================
// Default config
// ============================================================================
function defaultConfig() {
    return {
        version: KOSHI_VERSION,
        activeUsername: null,
        p2p: {
            corestorePath: DEFAULT_CORESTORE_DIR,
            autoSync: false,
            port: 0, // random port
        },
        accounts: {},
    };
}

// ============================================================================
// Load config with auto-migration from legacy formats
// ============================================================================
export function loadConfig() {
    try {
        if (existsSync(CONFIG_FILE)) {
            const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));

            // Already in v2 format
            if (data.accounts && typeof data.accounts === 'object') {
                // Ensure p2p section exists
                if (!data.p2p) {
                    data.p2p = defaultConfig().p2p;
                }
                // Ensure version is set
                data.version = KOSHI_VERSION;
                return data;
            }

            // Legacy v1.x format: single account at root level
            if (data.username && data.secretKey) {
                const migrated = {
                    version: KOSHI_VERSION,
                    activeUsername: data.username,
                    p2p: defaultConfig().p2p,
                    accounts: {
                        [data.username]: {
                            userId: data.userId || null,
                            username: data.username,
                            publicKey: data.publicKey || null,
                            secretKey: data.secretKey,
                            token: data.token || null,
                            nostr: null, // no Nostr key yet
                        },
                    },
                };
                // Save migrated config immediately
                trySaveConfig(migrated);
                return migrated;
            }
        }

        // Fallback to legacy .snsrc (plain text format)
        if (existsSync(SNSRC_FILE)) {
            const raw = readFileSync(SNSRC_FILE, 'utf-8').trim();
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.secretKey && parsed.username) {
                        const migrated = {
                            version: KOSHI_VERSION,
                            activeUsername: parsed.username,
                            p2p: defaultConfig().p2p,
                            accounts: {
                                [parsed.username]: {
                                    username: parsed.username,
                                    secretKey: parsed.secretKey,
                                    nostr: null,
                                },
                            },
                        };
                        return migrated;
                    }
                } catch {
                    // Plain text: first line = secret key, second line = username
                    const lines = raw.split('\n');
                    if (lines.length >= 2) {
                        const u = lines[1].trim();
                        const migrated = {
                            version: KOSHI_VERSION,
                            activeUsername: u,
                            p2p: defaultConfig().p2p,
                            accounts: {
                                [u]: {
                                    username: u,
                                    secretKey: lines[0].trim(),
                                    nostr: null,
                                },
                            },
                        };
                        return migrated;
                    }
                }
            }
        }
    } catch {
        // Config file is corrupt or missing
    }

    return defaultConfig();
}

// ============================================================================
// Save config to disk
// ============================================================================
export async function saveConfig(config) {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }

    // Ensure version is up to date
    config.version = KOSHI_VERSION;

    // Write config file
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

    // Update legacy .snsrc with active account's secret key (backward compat)
    const active = getActiveAccount(config);
    if (active && active.secretKey) {
        writeFileSync(SNSRC_FILE, `${active.secretKey}\n${active.username || ''}\n`, 'utf-8');
    }

    // Set restrictive permissions (best effort)
    try {
        const { chmodSync } = await import('node:fs');
        chmodSync(CONFIG_FILE, 0o600);
        chmodSync(SNSRC_FILE, 0o600);
    } catch {
        // chmod not critical
    }
}

// Best-effort save (doesn't throw)
async function trySaveConfig(config) {
    try {
        await saveConfig(config);
    } catch {
        // best effort
    }
}

// ============================================================================
// Active account helpers
// ============================================================================

/**
 * Get the currently active account object, or null.
 */
export function getActiveAccount(config) {
    if (config.activeUsername && config.accounts[config.activeUsername]) {
        return config.accounts[config.activeUsername];
    }
    return null;
}

/**
 * Get the active account's Nostr config, or null.
 */
export function getNostrConfig(config) {
    const acct = getActiveAccount(config);
    return acct?.nostr || null;
}

/**
 * Set the active account's Nostr config.
 */
export function setNostrConfig(config, nostrConfig) {
    const acct = getActiveAccount(config);
    if (acct) {
        acct.nostr = nostrConfig;
        saveConfig(config);
    }
}

/**
 * List all stored account usernames.
 */
export function listAccounts(config) {
    return Object.keys(config.accounts);
}

/**
 * Get the P2P settings.
 */
export function getP2PConfig(config) {
    return config.p2p || defaultConfig().p2p;
}

/**
 * Set P2P settings.
 */
export function setP2PConfig(config, p2pSettings) {
    config.p2p = { ...defaultConfig().p2p, ...p2pSettings };
    saveConfig(config);
}

// ============================================================================
// Convenience: load + get active in one call
// ============================================================================
export function getActiveBundle() {
    const config = loadConfig();
    const active = getActiveAccount(config);
    return { config, active, activeUsername: config.activeUsername };
}

// ============================================================================
// Legacy support: wrapper functions for backward-compatible no-arg calls
// The old API expected these functions to auto-load the config internally.
// ============================================================================

/** @deprecated Use loadConfig() directly */
export function loadFullConfig() {
    return loadConfig();
}

/** @deprecated Use saveConfig(config) directly */
export const saveFullConfig = saveConfig;

/**
 * @deprecated Use getActiveAccount(config) with explicit config.
 * Backward-compatible: loads config internally when called with no arguments.
 */
export function getActiveConfig(config = loadConfig()) {
    return getActiveAccount(config);
}

/**
 * @deprecated Use listAccounts(config) with explicit config.
 * Backward-compatible: loads config internally when called with no arguments.
 */
export function listAccountNames(config = loadConfig()) {
    return listAccounts(config);
}

/** @deprecated Use getActiveBundle() directly */
export const getConfigBundle = getActiveBundle;
export { CONFIG_DIR, CONFIG_FILE, SNSRC_FILE, DEFAULT_CORESTORE_DIR, KOSHI_VERSION };

export default {
    loadConfig,
    saveConfig,
    getActiveAccount,
    getNostrConfig,
    setNostrConfig,
    listAccounts,
    getP2PConfig,
    setP2PConfig,
    getActiveBundle,
    CONFIG_DIR,
    CONFIG_FILE,
    SNSRC_FILE,
    DEFAULT_CORESTORE_DIR,
    KOSHI_VERSION,
};
