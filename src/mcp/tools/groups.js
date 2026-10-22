// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP Tools — Groups
// License: MIT
// ============================================================================

import { z } from 'zod';

export function registerGroupTools(server, apiRequest) {
    // koshi_groups_list - List groups
    server.registerTool('koshi_groups_list', {
        description: 'List groups you belong to',
        inputSchema: z.object({})
    }, async () => {
        const result = await apiRequest('GET', '/api/groups');
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_group_messages - Get group messages
    server.registerTool('koshi_group_messages', {
        description: 'Get messages from a group',
        inputSchema: z.object({
            groupName: z.string().describe('Group name'),
            limit: z.number().int().min(1).max(100).default(50).describe('Max messages')
        })
    }, async ({ groupName, limit }) => {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        const result = await apiRequest('GET', `/api/groups/${encodeURIComponent(groupName)}/messages?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_group_send - Send group message
    server.registerTool('koshi_group_send', {
        description: 'Send a message to a group',
        inputSchema: z.object({
            groupName: z.string().describe('Group name'),
            content: z.string().max(5000).describe('Message content'),
            messageType: z.enum(['text', 'image', 'file']).default('text').describe('Message type'),
            replyTo: z.string().uuid().optional().describe('Reply to message ID')
        })
    }, async ({ groupName, content, messageType, replyTo }) => {
        const result = await apiRequest('POST', `/api/groups/${encodeURIComponent(groupName)}/messages`, {
            content, signature: '', messageType, replyTo
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
}

export default { registerGroupTools };