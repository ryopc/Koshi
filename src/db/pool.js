// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Database Connection Pool
// License: MIT
// ============================================================================
// Provides a singleton PostgreSQL connection pool using the `pg` module.
// Reads connection config from environment variables. In production (PandaStack),
// the DATABASE_URL env var is set automatically by the platform.
// ============================================================================

import pkg from 'pg';
const { Pool } = pkg;

import { logger } from '../logger.js';

let pool = null;

/**
 * Get or create the database connection pool.
 * @returns {import('pg').Pool}
 */
export function getPool() {
    if (pool) return pool;

    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error(
            'DATABASE_URL environment variable is not set. ' +
            'Please set it to your PostgreSQL connection string. ' +
            'Example: postgresql://user:password@localhost:5432/koshi'
        );
    }

    pool = new Pool({
        connectionString,
        max: 20,                       // Max connections in pool
        idleTimeoutMillis: 30000,       // Close idle clients after 30s
        connectionTimeoutMillis: 5000,  // Fail fast if DB is unreachable
    });

    // Log pool errors so they don't crash the process silently
    pool.on('error', (err) => {
        logger.error({ err }, 'Unexpected error on idle database client');
    });

    logger.info('Database connection pool created');
    return pool;
}

/**
 * Execute a query against the database.
 * Automatically acquires a client from the pool and releases it.
 *
 * @param {string} text - SQL query text (use $1, $2, etc. for parameters)
 * @param {Array} [params] - Query parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, params) {
    const p = getPool();
    const start = Date.now();
    try {
        const result = await p.query(text, params);
        const duration = Date.now() - start;
        logger.debug({ query: text.substring(0, 80), duration: `${duration}ms` }, 'Query executed');
        return result;
    } catch (err) {
        const duration = Date.now() - start;
        logger.error({ err, query: text.substring(0, 80), duration: `${duration}ms` }, 'Query failed');
        throw err;
    }
}

/**
 * Get a client from the pool for transactions.
 * Caller MUST release the client or call client.release() when done.
 * @returns {Promise<import('pg').PoolClient>}
 */
export async function getClient() {
    const p = getPool();
    const client = await p.connect();
    return client;
}

/**
 * Gracefully close the pool (used during shutdown).
 */
export async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
        logger.info('Database pool closed');
    }
}

export default { getPool, query, getClient, closePool };
