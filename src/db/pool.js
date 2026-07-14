// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Database Connection Pool
// License: MIT
// ============================================================================
// Provides a singleton PostgreSQL connection pool using the `pg` module.
// Reads connection config from environment variables.
//
// Production (Render.com + Neon.tech):
//   Set DATABASE_URL to your Neon.tech connection string.
//   SSL is enforced automatically for remote connections.
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

    const poolConfig = {
        connectionString,
        max: 20,                       // Max connections in pool
        idleTimeoutMillis: 30000,       // Close idle clients after 30s
        connectionTimeoutMillis: 10000, // Allow extra time for Neon.tech cold starts
    };

    // Enforce SSL in production (required by Neon.tech).
    // We check NODE_ENV + hostname to cover both production and any
    // Docker/non-local staging setups that use remote databases.
    const isProduction = process.env.NODE_ENV === 'production';
    const isLocalHost = connectionString.includes('localhost') ||
                        connectionString.includes('127.0.0.1') ||
                        connectionString.includes('0.0.0.0');

    if (!isLocalHost || isProduction) {
        poolConfig.ssl = {
            rejectUnauthorized: true,  // Neon uses valid Let's Encrypt certs
        };
    }

    pool = new Pool(poolConfig);

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
