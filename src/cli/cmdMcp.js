// ============================================================================
// Command: mcp (MCP server)
// ============================================================================
import chalk from 'chalk';

export async function cmdMcp(args) {
    const http = args.includes('--http');
    const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1]) || 3000;

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`\n  ${chalk.bold.cyan('🔌 MCP Server')}`);
        console.log(`  ${chalk.dim('─'.repeat(50))}`);
        console.log(`  ${chalk.cyan('kb mcp')}              Start MCP server (stdio)`);
        console.log(`  ${chalk.cyan('kb mcp --http')}       Start MCP server (HTTP)`);
        console.log(`  ${chalk.cyan('kb mcp --http --port=3000')}  Custom port`);
        return;
    }

    if (http) {
        console.log(chalk.yellow('HTTP mode not yet implemented. Use stdio mode: kb mcp'));
        process.exit(1);
    }

    console.log(chalk.dim('Starting MCP server (stdio)...'));
    const { spawn } = await import('node:child_process');
    const mcpProcess = spawn(process.execPath, ['bin/kb-mcp.js'], {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env }
    });

    mcpProcess.stdout.on('data', (data) => {
        console.log(data.toString());
    });

    process.on('SIGINT', () => {
        mcpProcess.kill('SIGTERM');
        process.exit(0);
    });

    mcpProcess.on('close', (code) => {
        process.exit(code || 0);
    });
}