#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Server Entry Point (Express + WebSocket)
// License: MIT
// ============================================================================
// Starts the HTTP server with Express and attaches WebSocket support.
// Reads configuration from environment variables.
//
// Usage:
//   node bin/server.js
//
// Environment:
//   PORT          - HTTP server port (default: 3000)
//   DATABASE_URL  - PostgreSQL connection string (required)
//   JWT_SECRET    - Secret key for JWT signing (required)
//   NODE_ENV      - 'development' or 'production' (default: 'development')
//   LOG_LEVEL     - 'debug', 'info', 'warn', 'error' (default: 'info' in prod, 'debug' in dev)
// ============================================================================

import { createServer } from 'node:http';
import { app, logger } from '../src/index.js';
import { initWebSocket, startHeartbeat } from '../src/ws/index.js';
import { closePool } from '../src/db/pool.js';
import { getOnlineCount } from '../src/ws/index.js';
import { runMigration } from '../src/db/migrate.js';

// Load .env file in development
try {
    const dotenv = await import('dotenv');
    dotenv.config();
} catch {
    // dotenv not available; that's fine
}

const PORT = parseInt(process.env.PORT) || 3000;

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'];
const missing = requiredEnvVars.filter((name) => !process.env[name]);

if (missing.length > 0) {
    logger.error(
        { missing },
        `Missing required environment variables: ${missing.join(', ')}`
    );
    console.error(`\n❌ Missing required environment variables:`);
    missing.forEach((name) => {
        console.error(`   - ${name}`);
    });
    console.error(`\n   Create a .env file or export these variables.`);
    console.error(`   See .env.example for reference.\n`);
    process.exit(1);
}

// ============================================================================
// Auto-migration: ensure database schema is up to date on startup
// ============================================================================
// This is especially important for Render free-tier instances that hibernate.
// The preDeployCommand only runs on fresh deploys, not on wake-up, so we
// run the migration here to guarantee tables exist on every start.
// ============================================================================
const migrationResult = await runMigration();
if (!migrationResult.success) {
    logger.warn({ message: migrationResult.message }, 'Auto-migration did not complete. Server will still start.');
} else {
    logger.info('Auto-migration complete');
}

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket server
const wss = initWebSocket(server, logger);
startHeartbeat();

// Start listening
// '0.0.0.0' を明示的に指定して、Render の外部からの通信を受け付けられるようにします。
server.listen(PORT, '0.0.0.0', () => {
    logger.info(

        { port: PORT, env: process.env.NODE_ENV || 'development' },
        `🚀 koshi server running on port ${PORT}`
    );
    console.log(`\n  ╔══════════════════════════════════════════════╗`);
    console.log(`  ║        🏄 koshi board server v1.1.0         ║`);
    console.log(`  ╠══════════════════════════════════════════════╣`);
    console.log(`  ║  REST API : http://localhost:${PORT}/api            ║`);
    console.log(`  ║  WebSocket: ws://localhost:${PORT}/ws               ║`);
    console.log(`  ║  Health   : http://localhost:${PORT}/api/health      ║`);
    console.log(`  ╠══════════════════════════════════════════════╣`);
    console.log(`  ║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(17)}║`);
    console.log(`  ╚══════════════════════════════════════════════╝\n`);
});

// Graceful shutdown
async function shutdown(signal) {
    logger.info({ signal }, 'Shutdown signal received');

    // Close WebSocket server
    if (wss) {
        wss.close(() => {
            logger.info('WebSocket server closed');
        });
    }

    // Close HTTP server
    server.close(() => {
        logger.info('HTTP server closed');
    });

    // Close database pool
    try {
        await closePool();
    } catch (err) {
        logger.error({ err }, 'Error closing database pool');
    }

    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Expose server for testing
export { server, wss };
