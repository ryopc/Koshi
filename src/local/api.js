// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Local API Layer (Drop-in Replacement for Remote HTTP API)
// License: MIT
// ============================================================================
// Provides all the same functions as the remote server API, but operates
// on the local SQLite database. Imported by the CLI when running in
// --local mode.
//
// Usage:
//   import { localAPI } from '../src/local/api.js';
//   await localAPI.init();
//   const result = await localAPI.register(username, publicKey);
// ============================================================================

import { initDB, closeDB, users, posts, dms, generateId, now } from './db.js';
import { signToken } from '../auth/jwt.js';
import { verifySignature } from '../auth/ed25519.js';

// ============================================================================
// Local API object
// ============================================================================

let _initialized = false;

export const localAPI = {
    /**
     * Initialize the local database.
     * Call this once before using any other API functions.
     */
    async init() {
        if (_initialized) return;
        initDB();
        _initialized = true;
    },

    /**
     * Close the local database.
     */
    async close() {
        closeDB();
        _initialized = false;
    },

    /**
     * Whether the local API is initialized.
     */
    get isReady() {
        return _initialized;
    },

    // ========================================================================
    // Auth API
    // ========================================================================

    /**
     * Register a new user locally.
     * This is a drop-in replacement for POST /api/auth/register.
     *
     * @param {string} username
     * @param {string} publicKey - ed25519 public key (hex)
     * @returns {{ userId: string, token: string }}
     */
    async register(username, publicKey) {
        // Validate
        if (!username || typeof username !== 'string') {
            throw new Error('Username is required and must be a string.');
        }
        if (!publicKey || typeof publicKey !== 'string') {
            throw new Error('Public key is required and must be a string.');
        }

        const trimmedUsername = username.trim().toLowerCase();

        if (!/^[a-z0-9_-]{3,32}$/.test(trimmedUsername)) {
            throw new Error('Invalid username format. Username must be 3-32 characters, alphanumeric with hyphens and underscores.');
        }

        if (!/^[0-9a-f]{64}$/i.test(publicKey)) {
            throw new Error('Invalid public key format. Public key must be a 64-character hex string (32 bytes).');
        }

        // Check for existing user
        const existing = await users.findByUsername(trimmedUsername);
        if (existing) {
            throw new Error('Conflict: Username or public key already registered.');
        }

        const existingByKey = await users.findByPublicKey(publicKey);
        if (existingByKey) {
            throw new Error('Conflict: Username or public key already registered.');
        }

        // Create user
        const user = await users.create({ username: trimmedUsername, publicKey });

        // Generate JWT
        const token = signToken({ userId: user.id, username: user.username });

        return { userId: user.id, token };
    },

    /**
     * Login locally by verifying signature.
     * Drop-in replacement for POST /api/auth/login.
     *
     * @param {string} username
     * @param {string} signature - ed25519 signature of the challenge
     * @returns {{ token: string, userId: string }}
     */
    async login(username, signature) {
        if (!username || typeof username !== 'string') {
            throw new Error('Username is required and must be a string.');
        }
        if (!signature || typeof signature !== 'string') {
            throw new Error('Signature is required and must be a string.');
        }

        const trimmedUsername = username.trim().toLowerCase();

        const user = await users.findByUsername(trimmedUsername);
        if (!user) {
            throw new Error('User not found. No account with that username.');
        }

        // Verify signature
        const challenge = `koshi:login:${user.username}`;
        const isValid = await verifySignature(challenge, signature, user.public_key);
        if (!isValid) {
            throw new Error('Authentication failed: Invalid signature.');
        }

        // Generate JWT
        const token = signToken({ userId: user.id, username: user.username });

        return { token, userId: user.id };
    },

    // ========================================================================
    // Users API
    // ========================================================================

    /**
     * Get user profile.
     * Drop-in replacement for GET /api/users/:username.
     */
    async getUserProfile(username) {
        if (!username) throw new Error('Username is required.');

        const profile = await users.getProfile(username);
        if (!profile) throw new Error('User not found.');

        return {
            id: profile.id,
            username: profile.username,
            displayName: profile.display_name,
            bio: profile.bio,
            avatarUrl: profile.avatar_url,
            followersCount: profile.followersCount,
            followingCount: profile.followingCount,
            createdAt: profile.created_at,
        };
    },

    /**
     * Get own profile (for whoami).
     */
    async getMyProfile(userId) {
        if (!userId) throw new Error('User ID is required.');

        const user = await users.findById(userId);
        if (!user) throw new Error('User not found.');

        const followersCount = await users.getFollowerCount(userId);
        const followingCount = await users.getFollowingCount(userId);

        return {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            bio: user.bio,
            avatarUrl: user.avatar_url,
            followersCount,
            followingCount,
            createdAt: user.created_at,
        };
    },

    /**
     * Search users.
     * Drop-in replacement for GET /api/users/search/:query.
     */
    async searchUsers(query) {
        if (!query || query.length < 2) {
            throw new Error('Search query must be at least 2 characters.');
        }

        const results = await users.search(query);

        return results.map((u) => ({
            id: u.id,
            username: u.username,
            displayName: u.display_name,
            avatarUrl: u.avatar_url,
        }));
    },

    /**
     * Update profile.
     * Drop-in replacement for PUT /api/users/me.
     */
    async updateProfile(userId, { displayName, bio, avatarUrl }) {
        const updated = await users.updateProfile(userId, { displayName, bio, avatarUrl });
        if (!updated) throw new Error('No fields to update.');

        return {
            id: updated.id,
            username: updated.username,
            displayName: updated.display_name,
            bio: updated.bio,
            avatarUrl: updated.avatar_url,
            createdAt: updated.created_at,
            updatedAt: updated.updated_at,
        };
    },

    /**
     * Follow a user.
     * Drop-in replacement for POST /api/users/:id/follow.
     */
    async followUser(followerId, followingId) {
        if (followerId === followingId) {
            throw new Error('You cannot follow yourself.');
        }

        const isAlready = await users.isFollowing(followerId, followingId);
        if (isAlready) {
            throw new Error('Already following this user.');
        }

        const targetUser = await users.findById(followingId);
        if (!targetUser) {
            throw new Error('User to follow not found.');
        }

        return users.follow(followerId, followingId);
    },

    /**
     * Unfollow a user.
     * Drop-in replacement for DELETE /api/users/:id/follow.
     */
    async unfollowUser(followerId, followingId) {
        const result = await users.unfollow(followerId, followingId);
        if (!result.success) {
            throw new Error('Follow relationship not found.');
        }
        return result;
    },

    /**
     * Resolve username to user ID.
     */
    async resolveUsername(username) {
        const user = await users.findByUsername(username);
        if (!user) throw new Error('User not found.');
        return user.id;
    },

    // ========================================================================
    // Posts API
    // ========================================================================

    /**
     * Create a post locally.
     * Drop-in replacement for POST /api/posts.
     */
    async createPost(userId, content, signature) {
        if (!content || typeof content !== 'string') {
            throw new Error('Content is required and must be a string.');
        }

        const trimmedContent = content.trim();
        if (trimmedContent.length === 0) {
            throw new Error('Content cannot be empty.');
        }
        if (trimmedContent.length > 2000) {
            throw new Error('Content exceeds maximum length of 2000 characters.');
        }

        if (!signature || typeof signature !== 'string') {
            throw new Error('Signature is required and must be a string.');
        }

        const result = await posts.create({
            authorId: userId,
            content: trimmedContent,
            signature,
        });

        // Fetch the created post with author info
        const created = await posts.getById(result.id);
        return created;
    },

    /**
     * Get feed.
     * Drop-in replacement for GET /api/posts/feed.
     */
    async getFeed(userId = null, limit = 20, offset = 0) {
        return posts.getFeed(userId, limit, offset);
    },

    /**
     * Get a single post.
     * Drop-in replacement for GET /api/posts/:id.
     */
    async getPost(postId) {
        const post = await posts.getById(postId);
        if (!post) throw new Error('Post not found.');
        return post;
    },

    // ========================================================================
    // DMs API
    // ========================================================================

    /**
     * Send a DM locally.
     * Drop-in replacement for POST /api/dms/:userId.
     */
    async sendDM(senderId, recipientId, content, signature) {
        if (!content || typeof content !== 'string') {
            throw new Error('Content is required and must be a string.');
        }

        const trimmedContent = content.trim();
        if (trimmedContent.length === 0) {
            throw new Error('Content cannot be empty.');
        }
        if (trimmedContent.length > 5000) {
            throw new Error('Content exceeds maximum length of 5000 characters.');
        }

        if (senderId === recipientId) {
            throw new Error('Cannot send a DM to yourself.');
        }

        const recipient = await users.findById(recipientId);
        if (!recipient) {
            throw new Error('Recipient user not found.');
        }

        const result = await dms.send({
            senderId,
            recipientId,
            content: trimmedContent,
            signature,
        });

        // Fetch the created DM
        const allDms = await dms.getForUser(senderId, 1, 0);
        return allDms[0] || { id: result.id };
    },

    /**
     * Get DMs.
     * Drop-in replacement for GET /api/dms.
     */
    async getDMs(userId, limit = 50, offset = 0, unreadOnly = false) {
        return dms.getForUser(userId, limit, offset, unreadOnly);
    },

    /**
     * Mark a DM as read.
     * Drop-in replacement for PUT /api/dms/:id/read.
     */
    async markDMAsRead(dmId, userId) {
        const result = await dms.markAsRead(dmId, userId);
        if (!result.success) {
            throw new Error('DM not found or you are not the recipient.');
        }
        return result;
    },

    /**
     * Get unread DM count.
     * Drop-in replacement for GET /api/dms/unread/count.
     */
    async getUnreadDMCount(userId) {
        const count = await dms.getUnreadCount(userId);
        return { count };
    },

    // ========================================================================
    // Admin API
    // ========================================================================

    /**
     * List all users (admin).
     */
    async adminListUsers(limit = 50, offset = 0) {
        return users.listAll(limit, offset);
    },

    /**
     * Delete a user (admin).
     */
    async adminDeleteUser(targetId, adminUserId) {
        const targetUser = await users.findById(targetId);
        if (!targetUser) throw new Error('User not found.');

        if (targetUser.id === adminUserId) {
            throw new Error('Cannot delete your own account.');
        }

        return users.deleteById(targetId);
    },

    /**
     * Toggle admin status.
     */
    async adminToggleAdmin(targetId, isAdmin, adminUserId) {
        if (targetId === adminUserId && !isAdmin) {
            throw new Error('Cannot revoke your own admin privileges.');
        }

        const result = await users.setAdmin(targetId, isAdmin);
        if (!result) throw new Error('User not found.');

        return {
            success: true,
            user: {
                id: result.id,
                username: result.username,
                isAdmin: !!result.is_admin,
            },
        };
    },
};

export default localAPI;
