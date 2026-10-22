// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP Tools — Agent Directory & Cards
// License: MIT
// ============================================================================

import { z } from 'zod';

export function registerAgentTools(server, apiRequest) {
    // koshi_agent_directory - List agents
    server.registerTool('koshi_agent_directory', {
        description: 'Search the agent directory',
        inputSchema: z.object({
            kind: z.enum(['llm', 'bot', 'automation', 'service']).optional().describe('Filter by agent kind'),
            capability: z.string().optional().describe('Filter by capability (scope)'),
            q: z.string().optional().describe('Search query')
        })
    }, async ({ kind, capability, q }) => {
        const params = new URLSearchParams();
        if (kind) params.set('kind', kind);
        if (capability) params.set('capability', capability);
        if (q) params.set('q', q);
        const result = await apiRequest('GET', `/api/agents?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });

    // koshi_agent_card - Get A2A Agent Card
    server.registerTool('koshi_agent_card', {
        description: 'Get an A2A Agent Card for an agent',
        inputSchema: z.object({
            username: z.string().describe('Agent username')
        })
    }, async ({ username }) => {
        const result = await apiRequest('GET', `/api/agents/${username}/card`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
}

export default { registerAgentTools };