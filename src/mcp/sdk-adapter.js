// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP SDK Adapter — Isolates MCP SDK version differences
// License: MIT
// ============================================================================
// Wraps @modelcontextprotocol/sdk to provide a stable interface.
// Currently targets v1.32.1 (stable). v2 alpha is isolated here.
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../logger.js';

/**
 * Create an MCP server instance with koshi defaults.
 */
export function createMcpServer(name = 'koshi', version = '6.0.0') {
    return new McpServer({
        name,
        version,
        capabilities: {
            tools: {},
            resources: {},
            prompts: {}
        }
    });
}

/**
 * Register a tool with standardized error handling.
 * All tools return { content: [{ type: 'text', text: string }] } format.
 */
export function registerTool(server, name, description, inputSchema, handler) {
    server.registerTool(name, {
        description,
        inputSchema
    }, async (args) => {
        try {
            const result = await handler(args);
            // Normalize result to MCP format
            if (typeof result === 'string') {
                return { content: [{ type: 'text', text: result }] };
            }
            if (result && result.content) {
                return result;
            }
            if (result && typeof result === 'object') {
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            return { content: [{ type: 'text', text: String(result) }] };
        } catch (err) {
            logger.error({ err, tool: name }, 'MCP tool error');
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        error: err.message || 'Tool execution failed',
                        code: err.code || 'TOOL_ERROR',
                        detail: err.detail
                    }, null, 2)
                }],
                isError: true
            };
        }
    });
}

/**
 * Register a resource with standardized handling.
 */
export function registerResource(server, uri, name, description, mimeType, handler) {
    server.registerResource(uri, {
        name,
        description,
        mimeType
    }, async (uri) => {
        try {
            const result = await handler(uri);
            if (typeof result === 'string') {
                return { contents: [{ uri, text: result, mimeType }] };
            }
            if (result && result.contents) {
                return result;
            }
            return { contents: [{ uri, text: JSON.stringify(result, null, 2), mimeType }] };
        } catch (err) {
            logger.error({ err, resource: uri }, 'MCP resource error');
            throw err;
        }
    });
}

/**
 * Register a prompt with standardized handling.
 */
export function registerPrompt(server, name, description, args, handler) {
    server.registerPrompt(name, {
        description,
        arguments: args || []
    }, async (args) => {
        try {
            const result = await handler(args);
            if (typeof result === 'string') {
                return { messages: [{ role: 'user', content: { type: 'text', text: result } }] };
            }
            if (result && result.messages) {
                return result;
            }
            return { messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(result, null, 2) } }] };
        } catch (err) {
            logger.error({ err, prompt: name }, 'MCP prompt error');
            throw err;
        }
    });
}

/**
 * Connect server to stdio transport.
 */
export async function connectStdio(server) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('MCP server connected via stdio');
}

/**
 * Connect server to Streamable HTTP transport.
 */
export function connectStreamableHTTP(server, req, res) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    return server.connect(transport);
}

export default { createMcpServer, registerTool, registerResource, registerPrompt, connectStdio, connectStreamableHTTP };