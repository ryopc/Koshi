// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP Tools — Events (SSE)
// License: MIT
// ============================================================================

import { z } from 'zod';

export function registerEventTools(server, apiRequest) {
    // koshi_watch - Watch events via SSE (finite duration)
    server.registerTool('koshi_watch', {
        description: 'Subscribe to real-time events via SSE (runs for durationSec then exits)',
        inputSchema: z.object({
            types: z.array(z.string()).optional().describe('Event types to filter (e.g., ["post.created", "dm.received"])'),
            durationSec: z.number().int().min(1).max(3600).default(30).describe('How long to watch in seconds'),
            limit: z.number().int().min(1).max(500).default(100).describe('Max events to collect')
        })
    }, async ({ types, durationSec, limit }) => {
        // This tool simulates SSE watching by polling
        const events = [];
        const startTime = Date.now();
        const endTime = startTime + durationSec * 1000;
        let since = null;

        while (Date.now() < endTime && events.length < limit) {
            const params = new URLSearchParams();
            if (types) params.set('types', types.join(','));
            if (since) params.set('since', String(since));
            params.set('limit', String(limit - events.length));

            try {
                const result = await apiRequest('GET', `/api/events?${params}`);
                const newEvents = result.events || [];
                for (const ev of newEvents) {
                    events.push(ev);
                    since = ev.id; // Use event ID for cursor
                }
                if (events.length >= limit) break;
            } catch (err) {
                // Ignore transient errors
            }

            // Small delay to avoid hammering
            await new Promise(r => setTimeout(r, 1000));
        }

        return { content: [{ type: 'text', text: JSON.stringify({ events, count: events.length }, null, 2) }] };
    });
}

export default { registerEventTools };