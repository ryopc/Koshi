// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Logger Module
// License: MIT
// ============================================================================
// Standalone logger using pino. Extracted into its own module to avoid
// circular dependency issues when API/WS/DB modules need logging.
//
// Usage:
//   import { logger } from '../logger.js';
//   logger.info('message');
//   logger.error({ err }, 'context');
// ============================================================================

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Pino logger instance.
 *
 * In development: human-readable output via pino-pretty
 * In production: JSON output (for log aggregation in PandaStack)
 *
 * Log levels: debug, info, warn, error
 */
export const logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:HH:MM:ss',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
});

export default logger;
