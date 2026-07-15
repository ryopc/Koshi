// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Express App Setup
// License: MIT
// ============================================================================
// Configures Express with middleware, routes, and error handling.
// The logger is imported from the standalone logger module to avoid
// circular dependencies with API/WS/DB modules.
// ============================================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from './logger.js';
import { apiLimiter } from './middleware/rateLimit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Re-export logger for convenience
export { logger };

// ============================================================================
// Express app setup
// ============================================================================
export const app = express();

// Security headers
app.use(helmet());

// CORS — allow all origins for CLI clients
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// General API rate limiting
app.use('/api/', apiLimiter);

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}ms`,
            userId: req.user?.userId || 'anonymous',
        }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// ============================================================================
// Serve static web files (web version - limited features)
// ============================================================================
const webPath = join(__dirname, '..', 'web');
app.use(express.static(webPath, {
    index: 'index.html',
    extensions: ['html'],
    maxAge: '1h'
}));

// ============================================================================
// Import and mount API routes
// ============================================================================
import authRouter from './api/auth.js';
import usersRouter from './api/users.js';
import postsRouter from './api/posts.js';
import dmsRouter from './api/dms.js';
import adminRouter from './api/admin.js';

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/posts', postsRouter);
app.use('/api/dms', dmsRouter);
app.use('/api/admin', adminRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'koshi-api',
        version: '1.1.1',
        timestamp: new Date().toISOString(),
    });
});

// ============================================================================
// SPA Fallback - serve index.html for non-API routes
// ============================================================================
app.get('*', (req, res, next) => {
    // Skip API routes - let them hit the 404 handler
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
        return next();
    }
    res.sendFile(join(__dirname, '..', 'web', 'index.html'));
});

// ============================================================================
// 404 handler (API routes only)
// ============================================================================
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.path} not found.`,
    });
});

// ============================================================================
// Global error handler
// ============================================================================
app.use((err, req, res, _next) => {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    res.status(err.status || 500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production'
            ? 'Something went wrong.'
            : err.message,
    });
});

export default app;
