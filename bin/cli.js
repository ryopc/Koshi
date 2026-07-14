#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// CLI/TUI Entry Point
// License: MIT
// ============================================================================
// The `kb` command-line interface. Provides all user-facing commands
// for interacting with the koshi board: register, login, post, feed,
// follow, dm, profile, search, and more.
//
// Usage:
//   kb <command> [options]
//   kb --help
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Constants
// ============================================================================
const CONFIG_DIR = join(homedir(), '.config', 'koshi');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const SNSRC_FILE = join(homedir(), '.snsrc');
const API_BASE = process.env.KOSHI_API_URL || 'https://koshi-api.ryopc.f5.si';
const WS_URL = process.env.KOSHI_WS_URL || 'wss://koshi-api.ryopc.f5.si';

// ============================================================================
// Helper: load configuration
// ============================================================================
function loadConfig() {
    try {
        if (existsSync(CONFIG_FILE)) {
            return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
        }
        // Fallback to legacy .snsrc
        if (existsSync(SNSRC_FILE)) {
            const data = readFileSync(SNSRC_FILE, 'utf-8').trim();
            if (data) {
                try {
                    return JSON.parse(data);
                } catch {
                    // Plain text format: first line is secretKey, second line is username
                    const lines = data.split('\n');
                    if (lines.length >= 2) {
                        return {
                            secretKey: lines[0].trim(),
                            username: lines[1].trim(),
                        };
                    }
                }
            }
        }
    } catch {
        // Config file doesn't exist or is corrupt
    }
    return {};
}

// ============================================================================
// Helper: save configuration
// ============================================================================
async function saveConfig(config) {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    // Also save to .snsrc for legacy compatibility
    writeFileSync(SNSRC_FILE, `${config.secretKey}\n${config.username}\n`, 'utf-8');
    // Set restrictive permissions
    try {
        const { chmod } = await import('node:fs/promises');
        await chmod(CONFIG_FILE, 0o600);
        await chmod(SNSRC_FILE, 0o600);
    } catch {
        // chmod not critical
    }
}

// ============================================================================
// Helper: HTTP request with auth
// ============================================================================
async function apiRequest(method, path, body = null, token = null) {
    const url = `${API_BASE}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    return data;
}

// ============================================================================
// Helper: resolve username to user ID
// ============================================================================
async function resolveUsername(username, token) {
    const data = await apiRequest('GET', `/api/users/${username}`, null, token);
    return data.id;
}

// ============================================================================
// Command: register
// ============================================================================
async function cmdRegister(args) {
    const username = args[0];
    if (!username) {
        console.error(chalk.red('✖ Error: Username is required. Usage: kb register <username>'));
        process.exit(1);
    }

    const spinner = ora('Generating ed25519 keypair...').start();

    try {
        // Dynamically import crypto modules
        const { generateKeypair, derivePublicKey } = await import('../src/auth/ed25519.js');
        const keypair = generateKeypair();

        spinner.text = 'Registering with server...';

        const result = await apiRequest('POST', '/api/auth/register', {
            username,
            publicKey: keypair.publicKey,
        });

        // Store credentials
        await saveConfig({
            userId: result.userId,
            username,
            publicKey: keypair.publicKey,
            secretKey: keypair.secretKey,
            token: result.token,
        });

        spinner.succeed(chalk.green('Registration successful!'));

        console.log(`\n  ${chalk.bold('Username:')}  ${chalk.cyan(username)}`);
        console.log(`  ${chalk.bold('User ID:')}   ${chalk.dim(result.userId)}`);
        console.log(`  ${chalk.bold('Token:')}     ${chalk.dim(result.token.substring(0, 40))}...`);
        console.log(`\n  ${chalk.dim('Keys stored in:')} ${chalk.italic(CONFIG_FILE)}`);
        console.log(`  ${chalk.green('✓')} You are now logged in.`);
    } catch (err) {
        spinner.fail(chalk.red(`Registration failed: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: login
// ============================================================================
async function cmdLogin(args) {
    const username = args[0];
    if (!username) {
        console.error(chalk.red('✖ Error: Username is required. Usage: kb login <username>'));
        process.exit(1);
    }

    const config = loadConfig();

    if (!config.secretKey) {
        console.error(chalk.red('✖ Error: No secret key found.'));
        console.error(chalk.dim('  Use "kb register <username>" to create a new account,'));
        console.error(chalk.dim('  or import an existing key to ~/.snsrc.'));
        process.exit(1);
    }

    const spinner = ora('Signing authentication challenge...').start();

    try {
        const { signMessage } = await import('../src/auth/ed25519.js');
        const challenge = `koshi:login:${username}`;
        const signature = await signMessage(challenge, config.secretKey);

        spinner.text = 'Authenticating with server...';

        const result = await apiRequest('POST', '/api/auth/login', {
            username,
            signature,
        });

        // Update stored config
        config.username = username;
        config.userId = result.userId;
        config.token = result.token;
        await saveConfig(config);

        spinner.succeed(chalk.green('Login successful!'));

        console.log(`\n  ${chalk.bold('Username:')}  ${chalk.cyan(username)}`);
        console.log(`  ${chalk.bold('Token:')}     ${chalk.dim(result.token.substring(0, 40))}...`);
    } catch (err) {
        spinner.fail(chalk.red(`Login failed: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: whoami
// ============================================================================
async function cmdWhoami() {
    const config = loadConfig();

    if (!config.token || !config.username) {
        console.error(chalk.red('✖ Not logged in. Use "kb login <username>" or "kb register <username>".'));
        process.exit(1);
    }

    const spinner = ora('Fetching profile...').start();

    try {
        const data = await apiRequest('GET', `/api/users/${config.username}`, null, config.token);
        spinner.stop();

        console.log(`\n  ${chalk.bold('Username:')}       ${chalk.cyan(data.username)}`);
        if (data.displayName) console.log(`  ${chalk.bold('Display Name:')}   ${data.displayName}`);
        if (data.bio) console.log(`  ${chalk.bold('Bio:')}            ${data.bio}`);
        console.log(`  ${chalk.bold('Followers:')}       ${data.followersCount}`);
        console.log(`  ${chalk.bold('Following:')}       ${data.followingCount}`);
        console.log(`  ${chalk.bold('Joined:')}          ${new Date(data.createdAt).toLocaleDateString()}`);
    } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch profile: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: post
// ============================================================================
async function cmdPost(args) {
    const content = args.join(' ');
    if (!content) {
        console.error(chalk.red('✖ Error: Content is required. Usage: kb post <message>'));
        process.exit(1);
    }

    if (content.length > 2000) {
        console.error(chalk.red(`✖ Error: Content exceeds 2000 characters (${content.length}).`));
        process.exit(1);
    }

    const config = loadConfig();

    if (!config.token || !config.secretKey) {
        console.error(chalk.red('✖ Not logged in. Use "kb login <username>" or "kb register <username>".'));
        process.exit(1);
    }

    const spinner = ora('Signing and posting...').start();

    try {
        const { signMessage } = await import('../src/auth/ed25519.js');
        const signature = await signMessage(content, config.secretKey);

        spinner.text = 'Submitting to koshi board...';

        const result = await apiRequest('POST', '/api/posts', {
            content,
            signature,
        }, config.token);

        spinner.succeed(chalk.green('Post created!'));

        console.log(`\n  ${chalk.dim('ID:')}      ${chalk.dim(result.id)}`);
        console.log(`  ${chalk.dim('Posted:')}  ${new Date(result.createdAt).toLocaleString()}`);
    } catch (err) {
        spinner.fail(chalk.red(`Failed to post: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: feed
// ============================================================================
async function cmdFeed(args) {
    const config = loadConfig();
    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 20;
    const flags = args.filter((a) => !a.startsWith('--'));

    const spinner = ora('Fetching feed...').start();

    try {
        const data = await apiRequest('GET', `/api/posts/feed?limit=${limit}`, null, config.token || null);
        spinner.stop();

        if (data.length === 0) {
            console.log(chalk.dim('\n  No posts in your feed. Follow some users or be the first to post!'));
            console.log(chalk.dim('  Try: kb post "Hello, koshi!"'));
            return;
        }

        console.log(`\n  ${chalk.bold.cyan('📋 Koshi Board Feed')} ${chalk.dim(`(${data.length} posts)`)}`);
        console.log(`  ${chalk.dim('─'.repeat(60))}\n`);

        for (const post of data) {
            const displayName = post.author.displayName || post.author.username;
            const time = new Date(post.createdAt).toLocaleString();

            console.log(`  ${chalk.bold(displayName)} ${chalk.dim(`@${post.author.username}`)}`);
            console.log(`  ${chalk.dim(time)}`);
            console.log(`  ${post.content}`);
            console.log(`  ${chalk.dim('─'.repeat(60))}\n`);
        }

        if (data.length === limit) {
            console.log(chalk.dim(`  Use kb feed --limit=${limit + 20} to see more.`));
        }
    } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch feed: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: follow
// ============================================================================
async function cmdFollow(args) {
    const username = args[0];
    if (!username) {
        console.error(chalk.red('✖ Error: Username is required. Usage: kb follow <username>'));
        process.exit(1);
    }

    const config = loadConfig();
    if (!config.token) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    const spinner = ora(`Resolving @${username}...`).start();

    try {
        const userData = await apiRequest('GET', `/api/users/${username}`, null, config.token);
        spinner.text = `Following @${username}...`;

        await apiRequest('POST', `/api/users/${userData.id}/follow`, {}, config.token);

        spinner.succeed(chalk.green(`You are now following @${username}!`));
    } catch (err) {
        spinner.fail(chalk.red(`Failed to follow: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: unfollow
// ============================================================================
async function cmdUnfollow(args) {
    const username = args[0];
    if (!username) {
        console.error(chalk.red('✖ Error: Username is required. Usage: kb unfollow <username>'));
        process.exit(1);
    }

    const config = loadConfig();
    if (!config.token) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    const spinner = ora(`Resolving @${username}...`).start();

    try {
        const userData = await apiRequest('GET', `/api/users/${username}`, null, config.token);
        spinner.text = `Unfollowing @${username}...`;

        await apiRequest('DELETE', `/api/users/${userData.id}/follow`, {}, config.token);

        spinner.succeed(chalk.yellow(`Unfollowed @${username}.`));
    } catch (err) {
        spinner.fail(chalk.red(`Failed to unfollow: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: dm
// ============================================================================
async function cmdDm(args) {
    const username = args[0];
    const message = args.slice(1).join(' ');

    if (!username || !message) {
        console.error(chalk.red('✖ Error: Usage: kb dm <username> <message>'));
        process.exit(1);
    }

    const config = loadConfig();
    if (!config.token || !config.secretKey) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    const spinner = ora(`Sending DM to @${username}...`).start();

    try {
        // Resolve recipient
        const userData = await apiRequest('GET', `/api/users/${username}`, null, config.token);

        // Sign message
        const { signMessage } = await import('../src/auth/ed25519.js');
        const signature = await signMessage(message, config.secretKey);

        spinner.text = 'Encrypting and sending...';

        const result = await apiRequest('POST', `/api/dms/${userData.id}`, {
            content: message,
            signature,
        }, config.token);

        spinner.succeed(chalk.green(`DM sent to @${username}!`));
        console.log(`  ${chalk.dim('ID:')} ${chalk.dim(result.id)}`);
    } catch (err) {
        spinner.fail(chalk.red(`Failed to send DM: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: dms
// ============================================================================
async function cmdDms(args) {
    const config = loadConfig();
    if (!config.token) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    const unreadOnly = args.includes('--unread');
    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 50;

    const spinner = ora('Fetching DMs...').start();

    try {
        const data = await apiRequest(
            'GET',
            `/api/dms?limit=${limit}${unreadOnly ? '&unread=true' : ''}`,
            null,
            config.token
        );
        spinner.stop();

        if (data.length === 0) {
            console.log(chalk.dim('\n  No messages in your inbox.'));
            if (!unreadOnly) {
                console.log(chalk.dim('  To send a DM: kb dm <username> <message>'));
            }
            return;
        }

        const title = unreadOnly ? '📨 Unread Messages' : '📨 Direct Messages';
        console.log(`\n  ${chalk.bold.cyan(title)} ${chalk.dim(`(${data.length} messages)`)}`);
        console.log(`  ${chalk.dim('─'.repeat(60))}\n`);

        for (const dm of data) {
            const isFromMe = dm.from.id === config.userId;
            const displayName = isFromMe ? dm.to.displayName || dm.to.username : dm.from.displayName || dm.from.username;
            const handle = isFromMe ? `@${dm.to.username}` : `@${dm.from.username}`;
            const time = new Date(dm.createdAt).toLocaleString();
            const readStatus = dm.isRead ? '' : chalk.yellow(' ●');

            if (isFromMe) {
                console.log(`  ${chalk.dim('→ To:')}   ${chalk.bold(displayName)} ${chalk.dim(handle)}${readStatus}`);
            } else {
                console.log(`  ${chalk.dim('← From:')} ${chalk.bold(displayName)} ${chalk.dim(handle)}${readStatus}`);
            }
            console.log(`  ${chalk.dim(time)}`);
            console.log(`  ${dm.content}`);
            console.log(`  ${chalk.dim('─'.repeat(60))}\n`);
        }
    } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch DMs: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: profile
// ============================================================================
async function cmdProfile(args) {
    const config = loadConfig();
    const targetUsername = args[0] || config.username;

    if (!targetUsername) {
        console.error(chalk.red('✖ Error: No username specified and not logged in.'));
        process.exit(1);
    }

    const spinner = ora(`Fetching profile @${targetUsername}...`).start();

    try {
        const data = await apiRequest('GET', `/api/users/${targetUsername}`, null, config.token || null);
        spinner.stop();

        console.log(`\n  ${chalk.bold.cyan('👤 Profile')}`);
        console.log(`  ${chalk.dim('─'.repeat(40))}`);
        console.log(`  ${chalk.bold('Username:')}       ${chalk.cyan(data.username)}`);
        if (data.displayName) console.log(`  ${chalk.bold('Display Name:')}   ${data.displayName}`);
        if (data.bio) console.log(`  ${chalk.bold('Bio:')}            ${data.bio}`);
        if (data.avatarUrl) console.log(`  ${chalk.bold('Avatar:')}         ${chalk.dim(data.avatarUrl)}`);
        console.log(`  ${chalk.bold('Followers:')}       ${data.followersCount}`);
        console.log(`  ${chalk.bold('Following:')}       ${data.followingCount}`);
        console.log(`  ${chalk.bold('Joined:')}          ${new Date(data.createdAt).toLocaleDateString()}`);
    } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch profile: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: search
// ============================================================================
async function cmdSearch(args) {
    const query = args.join(' ');
    if (!query || query.length < 2) {
        console.error(chalk.red('✖ Error: Search query must be at least 2 characters. Usage: kb search <query>'));
        process.exit(1);
    }

    const config = loadConfig();
    const spinner = ora(`Searching for "${query}"...`).start();

    try {
        const data = await apiRequest('GET', `/api/users/search/${encodeURIComponent(query)}`, null, config.token || null);
        spinner.stop();

        if (data.length === 0) {
            console.log(chalk.dim(`\n  No users found matching "${query}".`));
            return;
        }

        console.log(`\n  ${chalk.bold.cyan('🔍 Search Results')} ${chalk.dim(`for "${query}"`)}`);
        console.log(`  ${chalk.dim('─'.repeat(50))}\n`);

        for (const user of data) {
            const displayName = user.displayName || '(no display name)';
            console.log(`  ${chalk.bold(user.username)} ${chalk.dim(`— ${displayName}`)}`);
        }
        console.log();
    } catch (err) {
        spinner.fail(chalk.red(`Search failed: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: help
// ============================================================================
function showHelp(command = null) {
    const commands = {
        register: {
            usage: 'kb register <username>',
            desc: 'Create a new account with ed25519 keypair',
        },
        login: {
            usage: 'kb login <username>',
            desc: 'Authenticate using existing keypair',
        },
        whoami: {
            usage: 'kb whoami',
            desc: 'Show your profile information',
        },
        post: {
            usage: 'kb post <message>',
            desc: 'Create a new post on the koshi board',
        },
        feed: {
            usage: 'kb feed [--limit=20]',
            desc: 'Display your post feed',
        },
        follow: {
            usage: 'kb follow <username>',
            desc: 'Follow a user',
        },
        unfollow: {
            usage: 'kb unfollow <username>',
            desc: 'Unfollow a user',
        },
        dm: {
            usage: 'kb dm <username> <message>',
            desc: 'Send a direct message',
        },
        dms: {
            usage: 'kb dms [--unread] [--limit=50]',
            desc: 'View your direct messages',
        },
        profile: {
            usage: 'kb profile [username]',
            desc: 'View a user profile (default: your own)',
        },
        search: {
            usage: 'kb search <query>',
            desc: 'Search users by username or display name',
        },
        help: {
            usage: 'kb help [command]',
            desc: 'Show this help message',
        },
    };

    if (command && commands[command]) {
        const cmd = commands[command];
        console.log(`\n  ${chalk.bold.cyan(`kb ${command}`)}`);
        console.log(`  ${chalk.dim('─'.repeat(40))}`);
        console.log(`  ${chalk.bold('Usage:')} ${cmd.usage}`);
        console.log(`  ${chalk.bold('Description:')} ${cmd.desc}`);
        console.log();
        return;
    }

    console.log(`\n  ${chalk.bold.cyan('🏄 koshi — Terminal-Native Decentralized SNS')}`);
    console.log(`  ${chalk.dim('Version 1.0.0')}`);
    console.log(`\n  ${chalk.bold('Usage:')} kb <command> [options]\n`);
    console.log(`  ${chalk.bold('Commands:')}\n`);

    const maxLen = Math.max(...Object.values(commands).map((c) => c.usage.length));

    for (const [name, cmd] of Object.entries(commands)) {
        const padding = ' '.repeat(maxLen - cmd.usage.length + 2);
        console.log(`    ${chalk.cyan(cmd.usage)}${padding}${cmd.desc}`);
    }

    console.log(`\n  ${chalk.bold('Options:')}`);
    console.log(`    --help, -h    Show help for a command`);
    console.log(`    --version, -v Show version`);
    console.log(`\n  ${chalk.dim('Environment:')}`);
    console.log(`    ${chalk.dim('KOSHI_API_URL   API base URL (default: https://koshi-api.ryopc.f5.si)')}`);
    console.log(`    ${chalk.dim('KOSHI_WS_URL    WebSocket URL (default: wss://koshi-api.ryopc.f5.si)')}`);
    console.log();
}

// ============================================================================
// Command: version
// ============================================================================
function showVersion() {
    console.log('koshi v1.0.0');
    console.log('Terminal-native decentralized SNS');
    console.log('License: MIT');
    console.log('Author: game_ryo');
}

// ============================================================================
// Command: realtime feed (stream mode)
// ============================================================================
async function cmdRealtime() {
    const config = loadConfig();
    if (!config.token) {
        console.error(chalk.red('✖ Not logged in. Use "kb login" or "kb register" first.'));
        process.exit(1);
    }

    console.log(`\n  ${chalk.bold.cyan('📡 Connecting to realtime feed...')}`);
    console.log(`  ${chalk.dim('Press Ctrl+C to disconnect')}\n`);

    try {
        const { default: WebSocket } = await import('ws');
        const ws = new WebSocket(`${WS_URL}/ws?token=${config.token}`);

        ws.on('open', () => {
            console.log(chalk.green('  ✓ Connected! Waiting for new posts...\n'));
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                switch (msg.type) {
                    case 'connected':
                        // Initial connection confirmation
                        break;

                    case 'post_created':
                        console.log(`  ${chalk.bold.cyan('📝 New Post')}`);
                        console.log(`  ${chalk.bold(msg.payload.author.username)} ${chalk.dim(new Date(msg.payload.timestamp).toLocaleTimeString())}`);
                        console.log(`  ${msg.payload.content}`);
                        console.log(`  ${chalk.dim('─'.repeat(50))}\n`);
                        break;

                    case 'dm_received':
                        console.log(`  ${chalk.bold.yellow('✉ New DM from')} ${chalk.bold(msg.payload.from.username)}`);
                        console.log(`  ${msg.payload.content}`);
                        console.log(`  ${chalk.dim('─'.repeat(50))}\n`);
                        break;

                    case 'user_online':
                        console.log(`  ${chalk.green('🟢')} ${chalk.bold(msg.payload.username)} ${chalk.dim('is online')}`);
                        break;

                    case 'user_offline':
                        console.log(`  ${chalk.red('🔴')} ${chalk.dim(`${msg.payload.userId} went offline`)}`);
                        break;

                    case 'pong':
                        // Ignore pong
                        break;

                    default:
                        console.log(`  ${chalk.dim(`[${msg.type}]`)}`, msg.payload);
                }
            } catch {
                // Ignore parse errors
            }
        });

        ws.on('close', () => {
            console.log(chalk.yellow('\n  Disconnected from realtime feed.'));
            process.exit(0);
        });

        ws.on('error', (err) => {
            console.error(chalk.red(`\n  WebSocket error: ${err.message}`));
            process.exit(1);
        });

        // Keep the process alive until Ctrl+C
        process.on('SIGINT', () => {
            console.log(chalk.dim('\n  Closing connection...'));
            ws.close();
            process.exit(0);
        });
    } catch (err) {
        console.error(chalk.red(`Failed to connect: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Main CLI dispatcher
// ============================================================================
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    // No args
    if (!command || command === '--help' || command === '-h') {
        showHelp(args[1]);
        return;
    }

    if (command === '--version' || command === '-v') {
        showVersion();
        return;
    }

    // Dispatch commands
    switch (command) {
        case 'register':
            await cmdRegister(args.slice(1));
            break;

        case 'login':
            await cmdLogin(args.slice(1));
            break;

        case 'whoami':
            await cmdWhoami();
            break;

        case 'post':
            await cmdPost(args.slice(1));
            break;

        case 'feed':
            await cmdFeed(args.slice(1));
            break;

        case 'follow':
            await cmdFollow(args.slice(1));
            break;

        case 'unfollow':
            await cmdUnfollow(args.slice(1));
            break;

        case 'dm':
            await cmdDm(args.slice(1));
            break;

        case 'dms':
            await cmdDms(args.slice(1));
            break;

        case 'profile':
            await cmdProfile(args.slice(1));
            break;

        case 'search':
            await cmdSearch(args.slice(1));
            break;

        case 'realtime':
        case 'stream':
            await cmdRealtime();
            break;

        case 'help':
            showHelp(args[1]);
            break;

        default:
            console.error(chalk.red(`✖ Unknown command: "${command}"`));
            console.error(chalk.dim('  Run "kb help" to see available commands.'));
            process.exit(1);
    }
}

main().catch((err) => {
    console.error(chalk.red(`\n✖ Fatal error: ${err.message}`));
    if (process.env.DEBUG) {
        console.error(err.stack);
    }
    process.exit(1);
});
