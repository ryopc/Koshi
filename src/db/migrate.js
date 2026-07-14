#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Database Migration Script
// License: MIT
// ============================================================================
// Reads and executes src/db/schema.sql against the PostgreSQL database.
// Safe to run multiple times — all tables use IF NOT EXISTS.
//
// Usage (CLI):
//   node src/db/migrate.js
//
// Usage (programmatic):
//   import { runMigration } from './src/db/migrate.js';
//   await runMigration();
//
// Environment:
//   DATABASE_URL - PostgreSQL connection string (required)
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';
import { logger } from '../logger.js';

const { Pool } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// runMigration() — programmatic entry point
// ============================================================================
// Runs the schema migration against the database.
// Uses the project's logger if available, falls back to console.
// Safe to call multiple times (all CREATE statements use IF NOT EXISTS).
//
// Returns: { success: boolean, message: string }
// ============================================================================
export async function runMigration() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        const msg = 'DATABASE_URL environment variable is not set. Skipping migration.';
        logger.warn(msg);
        return { success: false, message: msg };
    }

    const pool = new Pool({ connectionString, connectionTimeoutMillis: 10000 });

    try {
        // Test connection
        await pool.query('SELECT NOW()');

        // Read schema file
        const schemaPath = join(__dirname, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf-8');

        // Execute schema (pg allows multi-statement queries)
        await pool.query(schema);

        const msg = 'Database migration completed. All tables and indexes are up to date.';
        logger.info(msg);
        return { success: true, message: msg };
    } catch (err) {
        const msg = `Database migration failed: ${err.message}`;
        logger.error({ err }, msg);
        return { success: false, message: msg };
    } finally {
        await pool.end();
    }
}

// ============================================================================
// CLI entry point (when run directly: node src/db/migrate.js)
// ============================================================================
async function main() {
    // Load .env file if present (development only)
    try {
        const dotenv = await import('dotenv');
        dotenv.config();
    } catch {
        // dotenv not available in production; that's fine
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('❌ FATAL: DATABASE_URL environment variable is not set.');
        console.error('   Set it to your PostgreSQL connection string.');
        console.error('   Example: postgresql://user:password@localhost:5432/koshi');
        process.exit(1);
    }

    console.log('📦 Connecting to database...');

    const result = await runMigration();

    if (result.success) {
        console.log('   Tables created: users, follows, kb_posts, dms');
        console.log('   Indexes created: username, public_key, follower/following, posts, dms');
        process.exit(0);
    } else {
        process.exit(1);
    }
}

main();
