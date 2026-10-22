// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP Tools — Direct Messages
// License: MIT
// ============================================================================

import { z } from 'zod';

export function registerDmTools(server, apiRequest) {
    // koshi_dm_send - Send DM
    server.registerTool('koshi_dm_send', {
        description: 'Send a direct message to a user',
        inputSchema: z.object({
            username: z.string().describe('Recipient username'),
            content: z.string().max(5000).describe('Message content (max 5000 chars)')
        })
    }, async ({ username, content }) => {
        const result = await apiRequest('POST', `/api/dms/${username}`, { content, signature: '' });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_dm_list - List DMs
    server.registerTool('koshi_dm_list', {
        description: 'List direct messages (sent + received)',
        inputSchema: z.object({
            unreadOnly: z.boolean().default(false).describe('Show only unread DMs'),
            limit: z.number().int().min(1).max(100).default(50).describe('Max DMs to return')
        })
    }, async ({ unreadOnly, limit }) => {
        const params = new URLSearchParams();
        if (unreadOnly) params.set('unread', 'true');
        params.set('limit', String(limit));
        const result = await apiRequest('GET', `/api/dms?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_dm_read - Mark DM as read
    server.registerTool('koshi_dm_read', {
        description: 'Mark a DM as read',
        inputSchema: z.object({
            dmId: z.string().uuid().describe('DM ID to mark as read')
        })
    }, async ({ dmId }) => {
        const result = await apiRequest('PUT', `/api/dms/${dmId}/read`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
}

export default { registerDmTools };