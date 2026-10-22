// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP Tools — Users & Profiles
// License: MIT
// ============================================================================

import { z } from 'zod';

export function registerUserTools(server, apiRequest) {
    // koshi_search_users - Search users
    server.registerTool('koshi_search_users', {
        description: 'Search users by username or display name',
        inputSchema: z.object({
            query: z.string().min(1).describe('Search query'),
            limit: z.number().int().min(1).max(50).default(20).describe('Max results')
        })
    }, async ({ query, limit }) => {
        const result = await apiRequest('GET', `/api/users/search/${encodeURIComponent(query)}?limit=${limit}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_get_profile - Get user profile
    server.registerTool('koshi_get_profile', {
        description: 'Get a user profile by username',
        inputSchema: z.object({
            username: z.string().describe('Username to look up')
        })
    }, async ({ username }) => {
        const result = await apiRequest('GET', `/api/users/${username}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_edit_profile - Update own profile
    server.registerTool('koshi_edit_profile', {
        description: 'Update your own profile',
        inputSchema: z.object({
            displayName: z.string().max(64).optional().describe('Display name'),
            bio: z.string().max(500).optional().describe('Bio'),
            avatarUrl: z.string().url().optional().describe('Avatar URL')
        })
    }, async ({ displayName, bio, avatarUrl }) => {
        const body = {};
        if (displayName !== undefined) body.displayName = displayName;
        if (bio !== undefined) body.bio = bio;
        if (avatarUrl !== undefined) body.avatarUrl = avatarUrl;
        const result = await apiRequest('PUT', '/api/users/me', body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_follow - Follow a user
    server.registerTool('koshi_follow', {
        description: 'Follow a user',
        inputSchema: z.object({
            username: z.string().describe('Username to follow')
        })
    }, async ({ username }) => {
        const result = await apiRequest('POST', `/api/users/${username}/follow`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_unfollow - Unfollow a user
    server.registerTool('koshi_unfollow', {
        description: 'Unfollow a user',
        inputSchema: z.object({
            username: z.string().describe('Username to unfollow')
        })
    }, async ({ username }) => {
        const result = await apiRequest('DELETE', `/api/users/${username}/follow`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
}

export default { registerUserTools };