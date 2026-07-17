// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Local Mode — Unified Entry Point
// License: MIT
// ============================================================================
// Ties together the local SQLite database, local API layer, P2P sync bridge,
// and local Express server. This is the main entry point for --local mode.
//
// Usage:
//   import { initLocalMode, getLocalAPI, closeLocalMode } from '../src/local/index.js';
//   await initLocalMode({ p2p: p2pModule });
//   const feed = await getLocalAPI().getFeed();
// ============================================================================

import { initDB, closeDB } from './db.js';
import { localAPI } from './api.js';
import { initP2PBridge, closeP2PBridge } from './p2p-bridge.js';
import { startLocalServer } from './server.js';
import { logger } from '../logger.js';

// ============================================================================
// State
// ============================================================================

let _initialized = false;
let _p2pModule = null;
let _localServer = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize local mode.
 *
 * This will:
 *   1. Initialize the local SQLite database
 *   2. Optionally start P2P sync (if p2p module is provided and ready)
 *   3. Optionally start a local web server
 *
 * @param {object} [options]
 * @param {object} [options.p2p] - P2P module instance (optional)
 * @param {boolean} [options.server=false] - Whether to start local web server
 * @param {number} [options.serverPort=0] - Port for local web server (0 = random)
 * @returns {Promise<{ api: object, server: object|null }>}
 */
export async function initLocalMode(options = {}) {
    if (_initialized) {
        return { api: localAPI, server: _localServer };
    }

    logger.info('Local-Mode: Initializing...');

    // 1. Initialize database
    await localAPI.init();
    logger.info('Local-Mode: SQLite database ready');

    // 2. Initialize P2P sync bridge if P2P module is provided
    _p2pModule = options.p2p || null;
    if (_p2pModule) {
        try {
            const bridged = await initP2PBridge(_p2pModule);
            if (bridged) {
                logger.info('Local-Mode: P2P sync bridge active');
            }
        } catch (err) {
            logger.warn({ err: err.message }, 'Local-Mode: P2P bridge init failed (non-critical)');
        }
    }

    // 3. Start local web server if requested
    if (options.server) {
        try {
            _localServer = await startLocalServer({ port: options.serverPort || 0 });
            logger.info({ port: _localServer.port }, 'Local-Mode: Web server started');
        } catch (err) {
            logger.warn({ err: err.message }, 'Local-Mode: Web server start failed (non-critical)');
        }
    }

    _initialized = true;
    logger.info('Local-Mode: Ready');

    return {
        api: localAPI,
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

    // Close P2P bridge
    try {
        await closeP2PBridge();
    } catch (err) {
        logger.warn({ err: err.message }, 'Local-Mode: P2P bridge close');
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
    _p2pModule = null;
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
    getLocalServer,
    closeLocalMode,
    isLocalMode,
};
