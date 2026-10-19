// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// API Router Index
// License: MIT
// ============================================================================
// Aggregates all API route modules.
// ============================================================================

import { Router } from 'express';
import authRoutes from './auth.js';
import usersRoutes from './users.js';
import postsRoutes from './posts.js';
import dmsRoutes from './dms.js';
import groupsRoutes from './groups.js';
import devicesRoutes from './devices.js';
import keysRoutes from './keys.js';
import adminRoutes from './admin.js';
import p2pRoutes from './p2p.js';

const router = Router();

// Health check
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
router.use('/auth', authRoutes);

// User routes
router.use('/users', usersRoutes);

// Post routes
router.use('/posts', postsRoutes);

// DM routes
router.use('/dms', dmsRoutes);

// Group routes
router.use('/groups', groupsRoutes);

// Device routes
router.use('/devices', devicesRoutes);

// Key bundle routes
router.use('/keys', keysRoutes);

// Admin routes
router.use('/admin', adminRoutes);

// P2P routes
router.use('/p2p', p2pRoutes);

export default router;