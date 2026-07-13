#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Database Migration Script
// License: MIT
// ============================================================================
// Reads and executes src/db/schema.sql against the PostgreSQL database.
// Safe to run multiple times — all tables use IF NOT EXISTS.
//
// Usage:
//   node src/db/migrate.js
//
// Environment:
//   DATABASE_URL - PostgreSQL connection string (required)
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
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

    let pkg;
    try {
        pkg = await import('pg');
    } catch {
        console.error('❌ FATAL: "pg" module not found. Run "npm install" first.');
        process.exit(1);
    }

    const { Pool } = pkg.default;
    const pool = new Pool({ connectionString });

    try {
        // Test connection
        await pool.query('SELECT NOW()');
        console.log('✅ Connected to database successfully.');

        // Read schema file
        const schemaPath = join(__dirname, 'schema.sql');
        const schema = readFileSync(schemaPath, 'utf-8');

        console.log('📄 Running schema migration...');

        // Execute schema (split by semicolons to handle potential multi-statement issues,
        // but pg allows multi-statement queries so we can run it all at once)
        await pool.query(schema);

        console.log('✅ Migration completed successfully.');
        console.log('   Tables created: users, follows, kb_posts, dms');
        console.log('   Indexes created: username, public_key, follower/following, posts, dms');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        if (err.stack) {
            console.error('   Stack:', err.stack);
        }
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
