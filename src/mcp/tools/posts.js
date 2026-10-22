// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP Tools — Posts & Feed
// License: MIT
// ============================================================================

import { z } from 'zod';

export function registerPostTools(server, apiRequest) {
    // koshi_post - Create a post
    server.registerTool('koshi_post', {
        description: 'Create a new post on the koshi board',
        inputSchema: z.object({
            content: z.string().max(2000).describe('Post content (max 2000 chars)'),
            mentions: z.array(z.string()).optional().describe('Usernames to mention (without @)'),
            replyTo: z.string().uuid().optional().describe('Post ID to reply to')
        })
    }, async ({ content, mentions, replyTo }) => {
        const result = await apiRequest('POST', '/api/posts', { content, signature: '', mentions, replyTo });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_feed - Get feed
    server.registerTool('koshi_feed', {
        description: 'Get the post feed (personalized if authenticated)',
        inputSchema: z.object({
            limit: z.number().int().min(1).max(100).default(20).describe('Number of posts to return'),
            before: z.string().uuid().optional().describe('Cursor for pagination (post ID)')
        })
    }, async ({ limit, before }) => {
        const params = new URLSearchParams();
        if (limit) params.set('limit', String(limit));
        if (before) params.set('before', before);
        const result = await apiRequest('GET', `/api/posts/feed?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_get_post - Get single post
    server.registerTool('koshi_get_post', {
        description: 'Get a single post by ID',
        inputSchema: z.object({
            id: z.string().uuid().describe('Post ID')
        })
    }, async ({ id }) => {
        const result = await apiRequest('GET', `/api/posts/${id}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
}

export default { registerPostTools };