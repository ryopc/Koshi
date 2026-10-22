#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// MCP Server Entry Point (stdio transport)
// License: MIT
// ============================================================================
// Starts the Koshi MCP server via stdio transport.
// Usage: kb mcp
// ============================================================================

import { createKoshiMcpServer } from '../src/mcp/server.js';
import { connectStdio } from '../src/mcp/sdk-adapter.js';
import { logger } from '../src/logger.js';
import { loadConfig } from '../src/config/config.js';

// Load config to get auth token
const config = loadConfig();
const activeUser = config.activeUsername ? config.accounts[config.activeUsername] : null;

async function main() {
    // Create authenticated API request function
    const apiRequest = async (method, path, body = null) => {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (activeUser?.token) {
            headers['Authorization'] = `Bearer ${activeUser.token}`;
        }

        const res = await fetch(`http://localhost:3000/api${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`API ${method} ${path} failed: ${res.status} ${text}`);
        }

        return res.json();
    };

    // Create and configure MCP server
    const server = createKoshiMcpServer(apiRequest);

    // Connect via stdio
    await connectStdio(server);

    // Keep process alive
    process.stdin.on('close', () => {
        logger.info('MCP stdio connection closed');
        process.exit(0);
    });
}

main().catch(err => {
    console.error('MCP server error:', err);
    process.exit(1);
});