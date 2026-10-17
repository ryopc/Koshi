// ============================================================================
// koshi – Terminal-Native Decentralized SNS v3.0.0
// Local Mode — Unified Entry Point (serverless)
// License: MIT
// ============================================================================
// Ties together the local SQLite database, local API layer, P2P mesh bridge,
// and local Express server. v3: P2P starts automatically as infrastructure.
//
// Usage:
//   import { initLocalMode, getLocalAPI, closeLocalMode } from '../src/local/index.js';
//   await initLocalMode();
//   const feed = await getLocalAPI().getFeed();
// ============================================================================

import { initDB, closeDB } from './db.js';
import { localAPI } from './api.js';
import { initP2PBridge, closeP2PBridge, announceAllProfiles } from './p2p-bridge.js';
import { startLocalServer } from './server.js';
import { logger } from '../logger.js';

// ============================================================================
// State
// ============================================================================

let _initialized = false;
let _p2pModule = null;
let _localServer = null;
let _p2pInitPromise = null;

/**
 * Resolve when the P2P mesh has finished (or failed) initializing.
 * Useful for UIs that want to show an accurate P2P status banner.
 *
 * @returns {Promise<void>|null} null if P2P is disabled
 */
export function whenP2PReady() {
    return _p2pInitPromise;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize local mode (serverless).
 *
 * This will:
 *   1. Initialize the local SQLite database
 *   2. Auto-start the P2P mesh (unless explicitly disabled)
 *   3. Wire the P2P ↔ SQLite sync bridge
 *   4. Optionally start a local web server
 *
 * @param {object} [options]
 * @param {object} [options.p2p] - Existing P2P module instance (optional)
 * @param {boolean} [options.p2pEnabled=true] - Set false to disable P2P
 * @param {boolean} [options.server=false] - Whether to start local web server
 * @param {number} [options.serverPort=0] - Port for local web server (0 = random)
 * @returns {Promise<{ api: object, p2p: object|null, server: object|null }>}
 */
export async function initLocalMode(options = {}) {
    // Already initialized: honor a late "start the web server" request
    // (e.g. CLI runs `kb serve` after auto-init with server:false).
    if (_initialized && !options.server) {
        return { api: localAPI, p2p: _p2pModule, server: _localServer };
    }
    if (_initialized && options.server) {
        if (!_localServer) {
            try {
                _localServer = await startLocalServer({ port: options.serverPort || 0 });
                logger.info({ port: _localServer.port }, 'Local-Mode: Web server started (late init)');
            } catch (err) {
                logger.warn({ err: err.message }, 'Local-Mode: Web server start failed (non-critical)');
            }
        }
        return { api: localAPI, p2p: _p2pModule, server: _localServer };
    }

    logger.info('Local-Mode: Initializing (serverless)...');

    // 1. Initialize database
    await localAPI.init();
    logger.info('Local-Mode: SQLite database ready');

    // 2. Start local web server if requested (BEFORE P2P so `kb serve`
    //    listens immediately — the P2P mesh must never block the HTTP API).
    if (options.server) {
        try {
            _localServer = await startLocalServer({ port: options.serverPort || 0 });
            logger.info({ port: _localServer.port }, 'Local-Mode: Web server started');
        } catch (err) {
            logger.warn({ err: err.message }, 'Local-Mode: Web server start failed (non-critical)');
        }
    }

    // 3. Start the P2P mesh as infrastructure (auto, non-blocking).
    //    hyperswarm discovery (DHT flush) can take seconds; it runs in the
    //    background so CLI commands and the web server are never blocked.
    if (options.p2pEnabled !== false) {
        if (options.p2p) {
            _p2pModule = options.p2p;
        } else {
            try {
                const p2p = await import('../p2p/index.js');
                _p2pModule = p2p;
            } catch (err) {
                logger.warn({ err: err.message }, 'Local-Mode: P2P import failed (non-critical)');
                _p2pModule = null;
            }
        }

        if (_p2pModule?.autoStart) {
            _p2pInitPromise = (async () => {
                try {
                    const ok = await _p2pModule.autoStart();
                    if (ok) {
                        await initP2PBridge(_p2pModule);
                        await announceAllProfiles();
                        logger.info('Local-Mode: P2P sync bridge active');
                    }
                } catch (err) {
                    logger.warn({ err: err.message }, 'Local-Mode: P2P init failed (non-critical)');
                }
            })();
        }
    }

    _initialized = true;
    logger.info('Local-Mode: Ready (serverless P2P)');

    return {
        api: localAPI,
        p2p: _p2pModule,
        server: _localServer,
    };
}

/**
 * Get the local API instance.
 *
 * @returns {object} localAPI
 */
export function getLocalAPI() {
    return localAPI;
}

/**
 * Get the local P2P module (may be null).
 *
 * @returns {object|null}
 */
export function getLocalP2P() {
    return _p2pModule;
}

/**
 * Get the local server info.
 *
 * @returns {object|null}
 */
export function getLocalServer() {
    return _localServer;
}

/**
 * Close local mode (cleanup).
 */
export async function closeLocalMode() {
    if (!_initialized) return;

    logger.info('Local-Mode: Shutting down...');

    // Wait for in-flight P2P init before tearing down
    if (_p2pInitPromise) {
        try { await _p2pInitPromise; } catch { /* ignore */ }
        _p2pInitPromise = null;
    }

    // Close P2P bridge
    try {
        await closeP2PBridge();
    } catch (err) {
        logger.warn({ err: err.message }, 'Local-Mode: P2P bridge close');
    }

    // Close P2P node
    if (_p2pModule?.closeP2PNode) {
        try {
            await _p2pModule.closeP2PNode();
        } catch (err) {
            logger.warn({ err: err.message }, 'Local-Mode: P2P node close');
        }
        _p2pModule = null;
    }

    // Close local server
    if (_localServer?.server) {
        try {
            await new Promise((resolve) => _localServer.server.close(resolve));
        } catch (err) {
            logger.warn({ err: err.message }, 'Local-Mode: Server close');
        }
        _localServer = null;
    }

    // Close database
    try {
        await localAPI.close();
    } catch (err) {
        logger.warn({ err: err.message }, 'Local-Mode: DB close');
    }

    _initialized = false;
    logger.info('Local-Mode: Shut down');
}

/**
 * Check if local mode is active.
 */
export function isLocalMode() {
    return _initialized;
}

export default {
    initLocalMode,
    getLocalAPI,
    getLocalP2P,
    getLocalServer,
    closeLocalMode,
    isLocalMode,
    whenP2PReady,
};
