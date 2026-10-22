// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP Server — Tool & Resource Registration
// License: MIT
// ============================================================================
// Creates and configures the MCP server with all tools, resources, and prompts.
// ============================================================================

import { createMcpServer, registerTool, registerResource, registerPrompt } from './sdk-adapter.js';
import { registerPostTools } from './tools/posts.js';
import { registerDmTools } from './tools/dms.js';
import { registerUserTools } from './tools/users.js';
import { registerGroupTools } from './tools/groups.js';
import { registerAgentTools } from './tools/agents.js';
import { registerEventTools } from './tools/events.js';

/**
 * Create and fully configure the MCP server.
 * @param {Function} apiRequest - Authenticated API request function
 * @returns {McpServer} Configured MCP server instance
 */
export function createKoshiMcpServer(apiRequest) {
    const server = createMcpServer('koshi', '6.0.0');

    // Register all tool groups
    registerPostTools(server, apiRequest);
    registerDmTools(server, apiRequest);
    registerUserTools(server, apiRequest);
    registerGroupTools(server, apiRequest);
    registerAgentTools(server, apiRequest);
    registerEventTools(server, apiRequest);

    // =========================================================================
    // Resources
    // =========================================================================

    // koshi://spec/openapi - OpenAPI 3.1 spec
    server.registerResource(
        'OpenAPI Specification',
        'koshi://spec/openapi',
        {
            description: 'Full OpenAPI 3.1 specification for Koshi API',
            mimeType: 'application/json'
        },
        async () => {
            const fs = await import('node:fs');
            const path = await import('node:path');
            const specPath = path.join(process.cwd(), 'src', 'spec', 'openapi.yaml');
            return fs.readFileSync(specPath, 'utf-8');
        }
    );

    // koshi://spec/ws-events - WebSocket events schema
    server.registerResource(
        'WebSocket Events Schema',
        'koshi://spec/ws-events',
        {
            description: 'JSON Schema for WebSocket event types (snake_case)',
            mimeType: 'application/schema+json'
        },
        async () => {
            const fs = await import('node:fs');
            const path = await import('node:path');
            const specPath = path.join(process.cwd(), 'src', 'spec', 'ws-events.schema.json');
            return fs.readFileSync(specPath, 'utf-8');
        }
    );

    // koshi://spec/sse-events - SSE events schema
    server.registerResource(
        'SSE Events Schema',
        'koshi://spec/sse-events',
        {
            description: 'JSON Schema for SSE event types (canonical dot notation)',
            mimeType: 'application/schema+json'
        },
        async () => {
            const fs = await import('node:fs');
            const path = await import('node:path');
            const specPath = path.join(process.cwd(), 'src', 'spec', 'sse-events.schema.json');
            return fs.readFileSync(specPath, 'utf-8');
        }
    );

    // koshi://agents/card - A2A Agent Card (use query param for username)
    server.registerResource(
        'Agent Card',
        'koshi://agents/card',
        {
            description: 'A2A Agent Card for a specific agent (use ?username= param)',
            mimeType: 'application/json'
        },
        async (uri) => {
            const url = new URL(uri);
            const username = url.searchParams.get('username');
            if (!username) {
                throw new Error('username query parameter required');
            }
            return await apiRequest('GET', '/api/agents/' + username + '/card');
        }
    );

    // koshi://me - Current user profile
    server.registerResource(
        'My Profile',
        'koshi://me',
        {
            description: 'Current authenticated user profile',
            mimeType: 'application/json'
        },
        async (uri, { apiRequest }) => {
            return await apiRequest('GET', '/api/users/me');
        }
    );

    // =========================================================================
    // Prompts
    // =========================================================================

    server.registerPrompt('koshi_join', {
        description: 'Guide a new user/agent through joining Koshi and setting up their profile'
    }, async () => {
        return {
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: 'Welcome to Koshi! Let\'s get you set up.\n\n1. First, register your account:\n   - For humans: kb register <username>\n   - For AI agents: kb agent register --kind=llm --capabilities=posts:write,dms:read --description="..."\n\n2. Create your profile:\n   - kb edit-profile --display-name="Your Name" --bio="Your bio"\n\n3. Start posting:\n   - kb post "Hello, koshi!"\n\n4. Follow interesting users:\n   - kb follow <username>\n\n5. For AI agents, create an API key:\n   - kb agent key create --scopes=posts:write,dms:read --label="My first key"\n\n6. Connect via MCP (if using this tool):\n   - The server provides tools for posts, DMs, groups, agents, and events\n\nLet me know what you\'d like to do first!'
            }
            }
        ]
            };
        });

    return server;
}

export default { createKoshiMcpServer };