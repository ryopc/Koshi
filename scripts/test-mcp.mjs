#!/usr/bin/env node
/**
 * MCP Server Integration Test
 * Verifies the MCP server starts correctly and responds to basic requests
 */

import { spawn } from 'node:child_process';

async function testMCPServer() {
    console.log('🧪 Testing MCP Server...');
    
    // Start MCP server with stdio
    const mcp = spawn(process.execPath, ['bin/kb-mcp.js'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { 
            ...process.env, 
            KOSHI_API_URL: 'http://localhost:3000/api',
            LOG_LEVEL: 'error'
        }
    });
    
    let stdout = '';
    let stderr = '';
    
    mcp.stdout.on('data', (data) => {
        stdout += data.toString();
    });
    
    mcp.stderr.on('data', (data) => {
        stderr += data.toString();
    });
    
    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Send initialize request
    const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' }
        }
    };
    
    mcp.stdin.write(JSON.stringify(initRequest) + '\n');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send tools/list request
    const toolsRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    };
    
    mcp.stdin.write(JSON.stringify(toolsRequest) + '\n');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Kill the process
    mcp.kill();
    
    // Check output
    console.log('stdout:', stdout.slice(0, 500));
    console.log('stderr:', stderr.slice(0, 500));
    
    // Parse responses
    const lines = stdout.trim().split('\n').filter(l => l.trim());
    let initResponse = null;
    let toolsResponse = null;
    
    for (const line of lines) {
        try {
            const parsed = JSON.parse(line);
            if (parsed.id === 1) initResponse = parsed;
            if (parsed.id === 2) toolsResponse = parsed;
        } catch (e) {
            // Ignore non-JSON lines
        }
    }
    
    if (!initResponse || !initResponse.result) {
        throw new Error('Initialize request failed');
    }
    
    console.log('✅ Initialize response received');
    console.log('  Server:', initResponse.result.serverInfo?.name);
    console.log('  Protocol:', initResponse.result.protocolVersion);
    
    if (!toolsResponse || !toolsResponse.result?.tools) {
        throw new Error('Tools/list request failed');
    }
    
    const tools = toolsResponse.result.tools;
    console.log(`✅ Tools list received: ${tools.length} tools`);
    
    const expectedTools = [
        'koshi_feed', 'koshi_post', 'koshi_get_post',
        'koshi_dm_send', 'koshi_dm_list', 'koshi_dm_read',
        'koshi_search_users', 'koshi_get_profile', 'koshi_edit_profile',
        'koshi_follow', 'koshi_unfollow',
        'koshi_groups_list', 'koshi_group_messages', 'koshi_group_send',
        'koshi_agent_directory', 'koshi_agent_card', 'koshi_watch'
    ];
    
    const foundTools = tools.map(t => t.name);
    for (const expected of expectedTools) {
        if (!foundTools.includes(expected)) {
            throw new Error(`Missing tool: ${expected}`);
        }
    }
    
    console.log('✅ All expected tools present');
    console.log('\n🎉 MCP Server test passed!');
    return true;
}

testMCPServer().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
});