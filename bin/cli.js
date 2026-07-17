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
// Features:
//   - Multi-account support (switch between accounts easily)
//   - Interactive login / account switching (no need to memorize usernames)
//   - Interactive DM with user search from a list
//   - Real-time chat
//
// Usage:
//   kb <command> [options]
//   kb --help
// ============================================================================

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { cursorTo, clearScreenDown } from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';

// Config management (v2.0.1)
import {
    loadFullConfig,
    saveFullConfig,
    getActiveConfig,
    listAccountNames,
    getConfigBundle,
    getServerUrl,
    setServerUrl,
    CONFIG_DIR,
    CONFIG_FILE,
    SNSRC_FILE,
} from '../src/config/config.js';

// ============================================================================
// Constants — resolve server URL from env > config > default
// ============================================================================
const DEFAULT_API = 'https://koshi-api.ryopc.f5.si';
const DEFAULT_WS = 'wss://koshi-api.ryopc.f5.si';

function getApiBase() {
    if (process.env.KOSHI_API_URL) return process.env.KOSHI_API_URL;
    const cfg = loadFullConfig();
    if (cfg.serverUrl) return cfg.serverUrl.replace(/\/$/, '');
    return DEFAULT_API;
}

function getWsBase() {
    if (process.env.KOSHI_WS_URL) return process.env.KOSHI_WS_URL;
    const cfg = loadFullConfig();
    if (cfg.serverUrl) {
        const url = cfg.serverUrl.replace(/\/$/, '');
        return url.replace(/^http/, 'ws');
    }
    return DEFAULT_WS;
}

const API_BASE = getApiBase();
const WS_URL = getWsBase();

// ============================================================================
// Local mode support (server-independent operation)
// ============================================================================
// When --local is passed, the CLI uses a local SQLite database + P2P sync
// instead of the remote API server. Works fully offline.
// ============================================================================

const IS_LOCAL = process.argv.includes('--local');
let _localAPI = null;

/**
 * Auto-initialize local mode if --local flag is present.
 * Called early in startup before any commands execute.
 */
async function autoInitLocalMode() {
    if (!IS_LOCAL) return false;

    console.log(chalk.dim('  🏠 Local mode activated (no server required)'));

    try {
        const { initLocalMode } = await import('../src/local/index.js');

        // Try to init P2P if available
        let p2pModule = null;
        try {
            p2pModule = await import('../src/p2p/index.js');
            await p2pModule.autoStart();
        } catch {
            // P2P not available, that's OK
        }

        const { api } = await initLocalMode({
            p2p: p2pModule,
            server: false,
        });

        _localAPI = api;
        console.log(chalk.dim('  ✓ Local database ready (' + chalk.italic('~/.config/koshi/local.db') + ')'));

        if (p2pModule) {
            try {
                const { initP2PBridge } = await import('../src/local/p2p-bridge.js');
                await initP2PBridge(p2pModule);
            } catch {
                // Bridge init is best-effort
            }
        }

        return true;
    } catch (err) {
        console.error(chalk.yellow('⚠ Local mode init failed: ' + err.message));
        console.error(chalk.dim('  Falling back to server mode...'));
        return false;
    }
}

// ============================================================================
// Interactive prompt helpers (readline)
// ============================================================================

/**
 * Ask a question and get text input from the user.
 */
async function askQuestion(query) {
    const rl = createInterface({ input, output });
    const answer = await rl.question(query);
    rl.close();
    return answer.trim();
}

/**
 * Show a numbered list of items and let the user pick one.
 * Returns the selected item or null if cancelled.
 */
async function selectFromList(items, displayFn, promptText) {
    if (items.length === 0) return null;

    console.log(`\n  ${chalk.bold.cyan(promptText)}`);
    console.log(`  ${chalk.dim('─'.repeat(50))}`);

    for (let i = 0; i < items.length; i++) {
        const line = displayFn(items[i], i);
        console.log(`  ${chalk.cyan(`${i + 1}.`)} ${line}`);
    }
    console.log(`  ${chalk.dim('  0.')} ${chalk.dim('キャンセル / Cancel')}`);
    console.log();

    const rl = createInterface({ input, output });
    let selected = null;

    while (selected === null) {
        const answer = await rl.question(`  ${chalk.bold('番号を選択 (1-' + items.length + '):')} `);
        const num = parseInt(answer.trim(), 10);

        if (answer.trim() === '0') {
            break;
        }

        if (isNaN(num) || num < 1 || num > items.length) {
            console.log(`  ${chalk.red(`✖ 無効な番号です。1〜${items.length} の番号を入力してください。`)}`);
            continue;
        }

        selected = items[num - 1];
    }

    rl.close();
    return selected;
}

/**
 * Confirm action with y/n prompt.
 */
async function confirmPrompt(message) {
    const rl = createInterface({ input, output });
    const answer = await rl.question(`  ${chalk.yellow(message)} ${chalk.dim('(y/N):')} `);
    rl.close();
    return answer.trim().toLowerCase() === 'y';
}

// ============================================================================
// Multi-account configuration system
// ============================================================================
// Configuration management is now in src/config/config.js
// Functions are imported at the top of this file.
// ============================================================================
// The config supports:
//   - Multi-account (existing)
//   - Nostr keys & relays (v2.0.0)
//   - P2P / corestore settings (v2.0.0)
//   - Bug fixes & stability improvements (v2.0.1)
// ============================================================================

// ============================================================================
// API Router: Routes to local API or remote HTTP based on mode
// ============================================================================

/**
 * Route an API call to either the local SQLite or remote HTTP server.
 */
async function apiRequest(method, path, body = null, token = null) {
    if (IS_LOCAL && _localAPI) {
        return localApiCall(method, path, body, token);
    }

    // ---- Remote HTTP mode ----
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

/**
 * Route an API call to the local SQLite engine.
 */
async function localApiCall(method, path, body, token) {
    // Strip query string before path parsing
    const cleanPath = path.split('?')[0];
    const parts = cleanPath.split('/').filter(Boolean);
    if (parts.length < 3) throw new Error('Invalid API path: ' + path);

    const resource = parts[1];
    const action = parts[2];

    // ---- Auth routes ----
    if (resource === 'auth') {
        if (action === 'register') return await _localAPI.register(body.username, body.publicKey);
        if (action === 'login') return await _localAPI.login(body.username, body.signature);
    }

    // ---- Users routes ----
    if (resource === 'users') {
        if (action === 'search' && parts.length >= 4)
            return await _localAPI.searchUsers(decodeURIComponent(parts[3]));
        if (action === 'me' && method === 'PUT')
            return await _localAPI.updateProfile(extractUserIdFromToken(token), body);
        if (parts.length === 3 && method === 'GET')
            return await _localAPI.getUserProfile(action);
        if (parts.length === 4 && parts[3] === 'follow' && method === 'POST')
            return await _localAPI.followUser(extractUserIdFromToken(token), action);
        if (parts.length === 4 && parts[3] === 'follow' && method === 'DELETE')
            return await _localAPI.unfollowUser(extractUserIdFromToken(token), action);
        if (parts.length === 4 && (parts[3] === 'followers' || parts[3] === 'following'))
            throw new Error('Local API: ' + path + ' not yet implemented');
    }

    // ---- Posts routes ----
    if (resource === 'posts') {
        if (action === 'feed') {
            const userId = token ? extractUserIdFromToken(token) : null;
            const searchParams = new URLSearchParams(path.split('?')[1] || '');
            return await _localAPI.getFeed(userId, parseInt(searchParams.get('limit')) || 20, parseInt(searchParams.get('offset')) || 0);
        }
        if (method === 'GET' && parts.length === 3)
            return await _localAPI.getPost(action);
        if (method === 'POST' && parts.length === 2)
            return await _localAPI.createPost(extractUserIdFromToken(token), body.content, body.signature);
    }

    // ---- DMs routes ----
    if (resource === 'dms') {
        if (method === 'GET' && parts.length === 2) {
            const userId = extractUserIdFromToken(token);
            const searchParams = new URLSearchParams(path.split('?')[1] || '');
            return await _localAPI.getDMs(userId, parseInt(searchParams.get('limit')) || 50, 0, searchParams.get('unread') === 'true');
        }
        if (action === 'unread' && parts[3] === 'count')
            return await _localAPI.getUnreadDMCount(extractUserIdFromToken(token));
        if (method === 'POST' && parts.length === 3)
            return await _localAPI.sendDM(extractUserIdFromToken(token), action, body.content, body.signature);
        if (parts.length === 4 && parts[3] === 'read' && method === 'PUT')
            return await _localAPI.markDMAsRead(action, extractUserIdFromToken(token));
    }

    throw new Error('Unknown API path in local mode: ' + method + ' ' + path);
}

/**
 * Extract user ID from a JWT token (for local mode).
 */
function extractUserIdFromToken(token) {
    if (!token) return null;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        return payload.userId || null;
    } catch {
        return null;
    }
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
    let username = args[0];

    // Interactive username input if not provided
    if (!username) {
        console.log(`\n  ${chalk.bold.cyan('📝 新規アカウント登録')}`);
        console.log(`  ${chalk.dim('3〜32文字の英数字、ハイフン、アンダースコア')}\n`);
        username = await askQuestion(`  ${chalk.bold('ユーザー名:')} `);
        if (!username) {
            console.error(chalk.red('✖ ユーザー名が入力されていません。'));
            process.exit(1);
        }
        username = username.toLowerCase().trim();
    }

    const spinner = ora('Generating ed25519 keypair...').start();

    try {
        const { generateKeypair, derivePublicKey } = await import('../src/auth/ed25519.js');
        const keypair = generateKeypair();

        spinner.text = IS_LOCAL ? 'Registering locally...' : 'Registering with server...';

        const result = await apiRequest('POST', '/api/auth/register', {
            username,
            publicKey: keypair.publicKey,
        });

        // Store credentials in multi-account config
        const { full } = getConfigBundle();
        full.accounts[username] = {
            userId: result.userId,
            username,
            publicKey: keypair.publicKey,
            secretKey: keypair.secretKey,
            token: result.token,
        };
        full.activeUsername = username;
        await saveFullConfig(full);

        spinner.succeed(chalk.green('Registration successful!'));

        console.log(`\n  ${chalk.bold('Username:')}  ${chalk.cyan(username)}`);
        console.log(`  ${chalk.bold('User ID:')}   ${chalk.dim(result.userId)}`);
        console.log(`  ${chalk.bold('Token:')}     ${chalk.dim(result.token.substring(0, 40))}...`);
        console.log(`\n  ${chalk.dim('Keys stored in:')} ${chalk.italic(CONFIG_FILE)}`);
        console.log(`  ${chalk.green('✓')} You are now logged in.`);
        console.log(`  ${chalk.dim('💡 Register more accounts with:')} ${chalk.italic('kb register <username>')}`);
    } catch (err) {
        spinner.fail(chalk.red(`Registration failed: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: login (interactive, multi-account aware)
// ============================================================================
async function cmdLogin(args) {
    const { full } = getConfigBundle();
    let username = args[0];

    // If username not provided, show interactive selection of saved accounts
    if (!username) {
        const savedAccounts = listAccountNames();

        if (savedAccounts.length === 0) {
            console.error(chalk.red('✖ 保存されたアカウントがありません。'));
            console.error(chalk.dim('  kb register <username> で新規登録するか、'));
            console.error(chalk.dim('  秘密鍵を ~/.config/koshi/config.json にインポートしてください。'));
            process.exit(1);
        }

        console.log(`\n  ${chalk.bold.cyan('🔑 アカウントを選択')}`);
        console.log(`  ${chalk.dim('ログインするアカウントを選んでください')}\n`);

        for (let i = 0; i < savedAccounts.length; i++) {
            const uname = savedAccounts[i];
            const acct = full.accounts[uname];
            const hasToken = acct && acct.token ? chalk.green('✓') : chalk.dim('○');
            const isActive = full.activeUsername === uname ? chalk.cyan(' ← 現在') : '';
            console.log(`  ${chalk.cyan(`${i + 1}.`)} ${chalk.bold(uname)} ${hasToken}${isActive}`);
        }
        console.log(`  ${chalk.dim('  0.')} ${chalk.dim('キャンセル')}`);
        console.log();

        const rl = createInterface({ input, output });
        let selected = null;

        while (selected === null) {
            const answer = await rl.question(`  ${chalk.bold('番号を選択 (1-' + savedAccounts.length + '):')} `);
            const num = parseInt(answer.trim(), 10);

            if (answer.trim() === '0') {
                rl.close();
                console.log(chalk.yellow('\n  キャンセルしました。'));
                return;
            }

            if (isNaN(num) || num < 1 || num > savedAccounts.length) {
                console.log(`  ${chalk.red(`✖ 無効な番号です。1〜${savedAccounts.length} の番号を入力してください。`)}`);
                continue;
            }

            selected = savedAccounts[num - 1];
        }
        rl.close();

        username = selected;
        console.log(`  → ${chalk.cyan(username)} を選択しました\n`);
    }

    // Now authenticate with the selected/typed username
    const acct = full.accounts[username];

    if (!acct || !acct.secretKey) {
        console.error(chalk.red(`✖ ユーザー「${username}」の秘密鍵が見つかりません。`));
        console.error(chalk.dim('  kb register で登録するか、config.json に鍵を追加してください。'));
        process.exit(1);
    }

    const spinner = ora('Signing authentication challenge...').start();

    try {
        const { signMessage } = await import('../src/auth/ed25519.js');
        const challenge = `koshi:login:${username}`;
        const signature = await signMessage(challenge, acct.secretKey);

        spinner.text = IS_LOCAL ? 'Authenticating locally...' : 'Authenticating with server...';

        const result = await apiRequest('POST', '/api/auth/login', {
            username,
            signature,
        });

        // Update the account's token and set as active
        full.accounts[username] = {
            ...acct,
            userId: result.userId,
            token: result.token,
        };
        full.activeUsername = username;
        await saveFullConfig(full);

        spinner.succeed(chalk.green('Login successful!'));

        console.log(`\n  ${chalk.bold('Username:')}  ${chalk.cyan(username)}`);
        console.log(`  ${chalk.bold('Token:')}     ${chalk.dim(result.token.substring(0, 40))}...`);
        console.log(`\n  ${chalk.dim('💡 他のアカウントに切り替える:')} ${chalk.italic('kb switch')}`);
        console.log(`  ${chalk.dim('📋 アカウント一覧:')} ${chalk.italic('kb accounts')}`);
    } catch (err) {
        spinner.fail(chalk.red(`Login failed: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: whoami
// ============================================================================
async function cmdWhoami() {
    const { full, activeUsername } = getConfigBundle();

    if (!activeUsername) {
        console.error(chalk.red('✖ ログインしていません。'));
        console.error(chalk.dim('  kb login  でアカウントを選択'));
        console.error(chalk.dim('  kb register <username>  で新規登録'));
        process.exit(1);
    }

    const config = full.accounts[activeUsername];

    if (!config.token) {
        console.error(chalk.red(`✖ @${activeUsername} のトークンがありません。再度ログインしてください。`));
        console.error(chalk.dim(`  kb login ${activeUsername}`));
        process.exit(1);
    }

    const spinner = ora('Fetching profile...').start();

    try {
        const data = await apiRequest('GET', `/api/users/${activeUsername}`, null, config.token);
        spinner.stop();

        console.log(`\n  ${chalk.bold('Username:')}       ${chalk.cyan(data.username)}`);
        if (data.displayName) console.log(`  ${chalk.bold('Display Name:')}   ${data.displayName}`);
        if (data.bio) console.log(`  ${chalk.bold('Bio:')}            ${data.bio}`);
        console.log(`  ${chalk.bold('Followers:')}       ${data.followersCount}`);
        console.log(`  ${chalk.bold('Following:')}       ${data.followingCount}`);
        console.log(`  ${chalk.bold('Joined:')}          ${new Date(data.createdAt).toLocaleDateString()}`);
        
        // Show multi-account context
        const total = listAccountNames().length;
        if (total > 1) {
            console.log(`\n  ${chalk.dim(`📋 保存アカウント: ${total}件`)}`);
            console.log(`  ${chalk.dim('💡 切り替え:')} ${chalk.italic('kb switch')}`);
        }
    } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch profile: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: post
// ============================================================================
async function cmdPost(args) {
    let content = args.join(' ');

    // Interactive input if no content provided
    if (!content) {
        console.log(`\n  ${chalk.bold.cyan('📝 新規投稿')}`);
        console.log(`  ${chalk.dim('Ctrl+D または空行でキャンセル')}\n`);
        const rl = createInterface({ input, output });
        content = (await rl.question(`  ${chalk.bold('本文:')} `)).trim();
        rl.close();

        if (!content) {
            console.log(chalk.yellow('\n  キャンセルしました。'));
            return;
        }
    }

    if (content.length > 2000) {
        console.error(chalk.red(`✖ Error: Content exceeds 2000 characters (${content.length}).`));
        process.exit(1);
    }

    const config = getActiveConfig();

    if (!config.token || !config.secretKey) {
        console.error(chalk.red('✖ Not logged in. Use "kb login" or "kb register".'));
        process.exit(1);
    }

    const spinner = ora('Signing and posting...').start();

    try {
        const { signMessage } = await import('../src/auth/ed25519.js');
        const signature = await signMessage(content, config.secretKey);

        spinner.text = IS_LOCAL ? 'Posting locally...' : 'Submitting to koshi board...';

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
    const config = getActiveConfig();
    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 20;

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
        if (config.username) {
            console.log(`  ${chalk.dim(`👤 @${config.username}`)}`);
        }
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
// Command: follow (interactive search mode)
// ============================================================================
async function cmdFollow(args) {
    let username = args[0];
    const config = getActiveConfig();

    if (!config.token) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    // Interactive mode: search and select user to follow
    if (!username) {
        console.log(`\n  ${chalk.bold.cyan('🔍 フォローするユーザーを検索')}`);
        console.log(`  ${chalk.dim('ユーザー名の一部を入力して検索できます')}`);

        const query = await askQuestion(`  ${chalk.bold('検索クエリ:')} `);
        if (!query || query.length < 2) {
            console.error(chalk.red('✖ 検索クエリは2文字以上必要です。'));
            process.exit(1);
        }

        const spinner = ora(`Searching for "${query}"...`).start();
        try {
            const users = await apiRequest('GET', `/api/users/search/${encodeURIComponent(query)}`, null, config.token);
            spinner.stop();

            if (users.length === 0) {
                console.log(chalk.dim(`\n  「${query}」に一致するユーザーが見つかりませんでした。`));
                return;
            }

            const selected = await selectFromList(
                users,
                (u) => `${chalk.bold(u.username)} ${chalk.dim(u.displayName ? `— ${u.displayName}` : '')}`,
                'フォローするユーザーを選択:'
            );

            if (!selected) {
                console.log(chalk.yellow('\n  キャンセルしました。'));
                return;
            }

            username = selected.username;
            console.log(`  → ${chalk.cyan(username)} を選択\n`);
        } catch (err) {
            spinner.fail(chalk.red(`Search failed: ${err.message}`));
            process.exit(1);
        }
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
    let username = args[0];
    const config = getActiveConfig();

    if (!config.token) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    // Interactive mode
    if (!username) {
        console.log(`\n  ${chalk.bold.cyan('🔍 アンフォローするユーザーを検索')}`);
        const query = await askQuestion(`  ${chalk.bold('検索クエリ:')} `);
        if (!query || query.length < 2) {
            console.error(chalk.red('✖ 検索クエリは2文字以上必要です。'));
            process.exit(1);
        }

        const spinner = ora(`Searching for "${query}"...`).start();
        try {
            const users = await apiRequest('GET', `/api/users/search/${encodeURIComponent(query)}`, null, config.token);
            spinner.stop();

            if (users.length === 0) {
                console.log(chalk.dim(`\n  「${query}」に一致するユーザーが見つかりませんでした。`));
                return;
            }

            const selected = await selectFromList(
                users,
                (u) => `${chalk.bold(u.username)} ${chalk.dim(u.displayName ? `— ${u.displayName}` : '')}`,
                'アンフォローするユーザーを選択:'
            );

            if (!selected) {
                console.log(chalk.yellow('\n  キャンセルしました。'));
                return;
            }

            username = selected.username;
            console.log(`  → ${chalk.cyan(username)} を選択\n`);
        } catch (err) {
            spinner.fail(chalk.red(`Search failed: ${err.message}`));
            process.exit(1);
        }
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
// Command: dm (interactive with user search)
// ============================================================================
async function cmdDm(args) {
    let username = args[0];
    let message = args.slice(1).join(' ');
    const config = getActiveConfig();

    if (!config.token || !config.secretKey) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    // Interactive mode: search user first if no username provided
    if (!username) {
        console.log(`\n  ${chalk.bold.cyan('✉️ DMを送信')}`);
        console.log(`  ${chalk.dim('送信先のユーザーを検索して選択します')}\n`);

        const query = await askQuestion(`  ${chalk.bold('ユーザー検索:')} `);
        if (!query || query.length < 2) {
            console.error(chalk.red('✖ 検索クエリは2文字以上必要です。'));
            process.exit(1);
        }

        const spinner = ora(`Searching for "${query}"...`).start();
        try {
            const users = await apiRequest('GET', `/api/users/search/${encodeURIComponent(query)}`, null, config.token);
            spinner.stop();

            if (users.length === 0) {
                console.log(chalk.dim(`\n  「${query}」に一致するユーザーが見つかりませんでした。`));
                return;
            }

            const selected = await selectFromList(
                users,
                (u) => `${chalk.bold(u.username)} ${chalk.dim(u.displayName ? `— ${u.displayName}` : '')}`,
                'DMを送信する相手を選択:'
            );

            if (!selected) {
                console.log(chalk.yellow('\n  キャンセルしました。'));
                return;
            }

            username = selected.username;
            console.log(`  → ${chalk.cyan(username)} を選択\n`);
        } catch (err) {
            spinner.fail(chalk.red(`Search failed: ${err.message}`));
            process.exit(1);
        }
    }

    // If message not provided, prompt interactively
    if (!message) {
        console.log(`  ${chalk.dim(`送信先: @${username}`)}`);
        const rl = createInterface({ input, output });
        message = (await rl.question(`  ${chalk.bold('メッセージ:')} `)).trim();
        rl.close();

        if (!message) {
            console.log(chalk.yellow('\n  キャンセルしました。'));
            return;
        }
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
        console.log(`  ${chalk.dim('💡 リアルタイムチャット:')} ${chalk.italic(`kb chat ${username}`)}`);
    } catch (err) {
        spinner.fail(chalk.red(`Failed to send DM: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: dms
// ============================================================================
async function cmdDms(args) {
    const config = getActiveConfig();
    if (!config.token) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    const unreadOnly = args.includes('--unread');
    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 100;

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
                console.log(chalk.dim('  To send a DM: kb dm (interactive mode)'));
                console.log(chalk.dim('  Or: kb dm <username> <message>'));
            }
            return;
        }

        // =========================================================================
        // Group messages by conversation partner
        // =========================================================================
        const conversations = new Map(); // partnerId -> { partner, messages[], unreadCount }

        for (const dm of data) {
            const isFromMe = dm.from.id === config.userId;
            const partner = isFromMe ? dm.to : dm.from;
            const partnerId = partner.id;

            if (!conversations.has(partnerId)) {
                conversations.set(partnerId, {
                    partner: {
                        id: partner.id,
                        username: partner.username,
                        displayName: partner.displayName,
                    },
                    messages: [],
                    unreadCount: 0,
                });
            }

            const conv = conversations.get(partnerId);
            conv.messages.push(dm);
            if (!isFromMe && !dm.isRead) {
                conv.unreadCount++;
            }
        }

        // Sort conversations by latest message time (most recent first)
        const sortedConvs = [...conversations.values()].sort((a, b) => {
            const aTime = new Date(a.messages[0].createdAt).getTime();
            const bTime = new Date(b.messages[0].createdAt).getTime();
            return bTime - aTime;
        });

        // =========================================================================
        // Render conversation list
        // =========================================================================
        const title = unreadOnly ? '📨 未読メッセージ' : '📨 受信箱';
        const totalUnread = [...conversations.values()].reduce((sum, c) => sum + c.unreadCount, 0);
        const unreadBadge = totalUnread > 0 ? chalk.yellow(` (${totalUnread}件未読)`) : '';

        console.log();
        console.log('  ' + chalk.bold.cyan(title) + chalk.dim(' ' + sortedConvs.length + '件の会話') + unreadBadge);
        console.log('  ' + chalk.cyan(('').padEnd(68, '─')));
        console.log();

        for (let i = 0; i < sortedConvs.length; i++) {
            const conv = sortedConvs[i];
            const partner = conv.partner;
            const latest = conv.messages[0];
            const isLatestFromMe = latest.from.id === config.userId;
            const previewWidth = Math.min(process.stdout.columns - 16 || 50, 50);

            // Determine preview text (truncated)
            let previewText = latest.content;
            if (previewText.length > previewWidth) {
                previewText = previewText.substring(0, previewWidth - 1) + '…';
            }

            // Timestamp of latest message
            const latestTime = new Date(latest.createdAt);
            const now = new Date();
            const isToday = latestTime.toDateString() === now.toDateString();
            const timeStr = isToday
                ? latestTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : latestTime.toLocaleDateString([], { month: 'numeric', day: 'numeric' });

            // Unread badge
            const unreadBadgeStr = conv.unreadCount > 0
                ? chalk.yellow(' ●' + (conv.unreadCount > 1 ? conv.unreadCount : ''))
                : '';

            // Bubble header: partner name
            const headerName = chalk.bold(partner.displayName || partner.username);
            const headerHandle = chalk.dim('@' + partner.username);
            const numberLabel = chalk.cyan((i + 1).toString().padStart(2, ' ') + '.');

            // Check if partner has display name
            const nameLine = partner.displayName
                ? headerName + ' ' + headerHandle
                : headerName;

            // ── Conversation Card ──
            // Top border with number and name
            const cardWidth = 66;
            const topBorder = chalk.cyan('┌─ ') + nameLine + unreadBadgeStr + chalk.dim(' ' + timeStr);
            const topPadding = cardWidth - topBorder.length + 10; // approximate
            console.log('  ' + topBorder);

            // Message preview (bubble style)
            const prefix = isLatestFromMe ? chalk.dim('→ ') : '';
            const previewBubble = chalk.white(prefix + previewText);
            console.log('  ' + chalk.cyan('│  ') + previewBubble);

            // "Last message" line
            const msgCount = conv.messages.length;
            const msgLabel = msgCount > 1 ? msgCount + ' messages' : '1 message';
            console.log('  ' + chalk.cyan('│  ') + chalk.dim(msgLabel));

            // Bottom border with quick action
            const actionHint = chalk.cyan('├─ ') + chalk.dim('kb chat ' + partner.username + '  ') + chalk.cyan('│');
            console.log('  ' + chalk.cyan('└' + ('').padEnd(cardWidth - 2, '─')) + chalk.cyan('┘'));

            // Spacing between cards
            console.log();
        }

        // ── Footer with legend ──
        console.log('  ' + chalk.dim('─'.repeat(68)));
        console.log('  ' + chalk.dim('番号を入力してチャット開始: ') + chalk.italic('kb chat <username>'));
        console.log('  ' + chalk.dim('💡 ') + chalk.italic('kb dm <username> <message>') + chalk.dim(' で直接送信'));

        // Interactive selection prompt
        const rl = createInterface({ input, output });
        console.log();
        const answer = await rl.question('  ' + chalk.bold('チャットする相手の番号を選択 (Enter=戻る): ') + ' ');
        rl.close();

        const num = parseInt(answer.trim(), 10);
        if (!isNaN(num) && num >= 1 && num <= sortedConvs.length) {
            const selected = sortedConvs[num - 1];
            console.log(chalk.dim('\n  ' + selected.partner.username + ' とのチャットを開始します...\n'));
            // Launch chat with this user
            await cmdChat([selected.partner.username]);
        }

    } catch (err) {
        spinner.fail(chalk.red('Failed to fetch DMs: ' + err.message));
        process.exit(1);
    }
}

async function cmdProfile(args) {
    const config = getActiveConfig();
    let targetUsername = args[0];

    // Interactive mode: search user if not specified
    if (!targetUsername) {
        if (!config.username) {
            console.error(chalk.red('✖ Error: No username specified and not logged in.'));
            process.exit(1);
        }

        console.log(`\n  ${chalk.bold.cyan('👤 ユーザーを検索')}`);
        console.log(`  ${chalk.dim('Enter を押すと自分のプロフィールを表示')}\n`);

        const query = await askQuestion(`  ${chalk.bold('ユーザー名の一部を入力:')} `);

        if (!query) {
            // Show own profile
            targetUsername = config.username;
        } else {
            const spinner = ora(`Searching for "${query}"...`).start();
            try {
                const users = await apiRequest('GET', `/api/users/search/${encodeURIComponent(query)}`, null, config.token || null);
                spinner.stop();

                if (users.length === 0) {
                    console.log(chalk.dim(`\n  「${query}」に一致するユーザーが見つかりませんでした。`));
                    return;
                }

                // If only one result, use it directly
                if (users.length === 1) {
                    targetUsername = users[0].username;
                    console.log(`  → ${chalk.cyan(targetUsername)}`);
                } else {
                    const selected = await selectFromList(
                        users,
                        (u) => `${chalk.bold(u.username)} ${chalk.dim(u.displayName ? `— ${u.displayName}` : '')}`,
                        'プロフィールを表示するユーザーを選択:'
                    );

                    if (!selected) {
                        console.log(chalk.yellow('\n  キャンセルしました。'));
                        return;
                    }

                    targetUsername = selected.username;
                    console.log(`  → ${chalk.cyan(targetUsername)} を選択\n`);
                }
            } catch (err) {
                spinner.fail(chalk.red(`Search failed: ${err.message}`));
                process.exit(1);
            }
        }
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
// Command: edit-profile (interactive mode)
// ============================================================================
async function cmdEditProfile(args) {
    const config = getActiveConfig();
    if (!config.token) {
        console.error(chalk.red('✖ Not logged in.'));
        process.exit(1);
    }

    // Parse flags or use interactive mode
    let displayName, bio, avatarUrl;
    let hasFlags = false;
    let isInteractive = false;

    if (args.length === 0) {
        // No flags: enter interactive editing mode
        isInteractive = true;
        console.log(`\n  ${chalk.bold.cyan('✏️ プロフィール編集')}`);
        console.log(`  ${chalk.dim('現在の値をそのまま使う場合は空Enter')}\n`);

        displayName = await askQuestion(`  ${chalk.bold('表示名')} ${chalk.dim('(displayName):')} `);
        bio = await askQuestion(`  ${chalk.bold('自己紹介')} ${chalk.dim('(bio):')} `);
        avatarUrl = await askQuestion(`  ${chalk.bold('アバターURL')} ${chalk.dim('(avatarUrl):')} `);

        if (!displayName && !bio && !avatarUrl) {
            console.log(chalk.yellow('\n  変更はありません。'));
            return;
        }

        console.log();
        const confirmed = await confirmPrompt('プロフィールを更新しますか？');
        if (!confirmed) {
            console.log(chalk.yellow('\n  キャンセルしました。'));
            return;
        }
    } else {
        for (const arg of args) {
            if (arg.startsWith('--display-name=')) {
                displayName = arg.slice('--display-name='.length);
                hasFlags = true;
            } else if (arg.startsWith('--bio=')) {
                bio = arg.slice('--bio='.length);
                hasFlags = true;
            } else if (arg.startsWith('--avatar-url=')) {
                avatarUrl = arg.slice('--avatar-url='.length);
                hasFlags = true;
            }
        }

        if (!hasFlags) {
            console.error(chalk.red('✖ Error: Provide at least one field to update.'));
            console.error(chalk.dim('  Usage: kb edit-profile --display-name="My Name" --bio="Hello!" --avatar-url="https://..."'));
            process.exit(1);
        }
    }

    const spinner = ora('Updating profile...').start();

    try {
        const body = {};
        if (displayName) body.displayName = displayName.trim();
        if (bio) body.bio = bio.trim();
        if (avatarUrl) body.avatarUrl = avatarUrl;

        const data = await apiRequest('PUT', '/api/users/me', body, config.token);

        spinner.succeed(chalk.green('Profile updated!'));

        console.log(`\n  ${chalk.bold('Username:')}       ${chalk.cyan(data.username)}`);
        if (data.displayName) console.log(`  ${chalk.bold('Display Name:')}   ${data.displayName}`);
        if (data.bio) console.log(`  ${chalk.bold('Bio:')}            ${data.bio}`);
        if (data.avatarUrl) console.log(`  ${chalk.bold('Avatar:')}         ${chalk.dim(data.avatarUrl)}`);
    } catch (err) {
        spinner.fail(chalk.red(`Failed to update profile: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: search (interactive mode)
// ============================================================================
async function cmdSearch(args) {
    let query = args.join(' ');
    const config = getActiveConfig();

    // Interactive mode
    if (!query || query.length < 2) {
        console.log(`\n  ${chalk.bold.cyan('🔍 ユーザー検索')}`);
        console.log(`  ${chalk.dim('ユーザー名または表示名の一部を入力')}\n`);
        query = await askQuestion(`  ${chalk.bold('検索クエリ:')} `);

        if (!query || query.length < 2) {
            console.error(chalk.red('✖ 検索クエリは2文字以上必要です。'));
            process.exit(1);
        }
    }

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

        // Offer quick actions
        console.log(`  ${chalk.dim('💡 プロフィール:')} ${chalk.italic(`kb profile <username>`)}`);
        console.log(`  ${chalk.dim('✉️ DM送信:')} ${chalk.italic(`kb dm <username>`)}`);
        console.log(`  ${chalk.dim('👤 フォロー:')} ${chalk.italic(`kb follow <username>`)}`);
    } catch (err) {
        spinner.fail(chalk.red(`Search failed: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// Command: accounts (list all saved accounts)
// ============================================================================
async function cmdAccounts() {
    const { full, activeUsername } = getConfigBundle();
    const names = listAccountNames();

    if (names.length === 0) {
        console.log(`\n  ${chalk.dim('保存されたアカウントはありません。')}`);
        console.log(`  ${chalk.dim('kb register <username>  で新規登録')}`);
        return;
    }

    console.log(`\n  ${chalk.bold.cyan('📋 アカウント一覧')} ${chalk.dim(`(${names.length}件)`)}`);
    console.log(`  ${chalk.dim('─'.repeat(60))}\n`);

    for (let i = 0; i < names.length; i++) {
        const uname = names[i];
        const acct = full.accounts[uname];
        const isActive = uname === activeUsername;
        const hasToken = acct && acct.token ? chalk.green('✓ ログイン済') : chalk.dim('未ログイン');
        const activeMark = isActive ? chalk.cyan(' ← 現在のアカウント') : '';

        console.log(`  ${chalk.cyan(`${i + 1}.`)} ${chalk.bold(isActive ? uname : chalk.dim(uname))}`);
        console.log(`     ${chalk.dim('鍵:')} ${hasToken}${activeMark}`);
        console.log();
    }

    console.log(`  ${chalk.dim('💡 切り替え:')} ${chalk.italic('kb switch <username>')}`);
    console.log(`  ${chalk.dim('💡 削除:')} ${chalk.italic('kb account remove <username>')}`);
}

// ============================================================================
// Command: switch (switch active account)
// ============================================================================
async function cmdSwitch(args) {
    const { full, activeUsername } = getConfigBundle();
    const names = listAccountNames();

    if (names.length === 0) {
        console.error(chalk.red('✖ 保存されたアカウントがありません。'));
        console.error(chalk.dim('  kb register <username>  でアカウントを作成してください。'));
        process.exit(1);
    }

    let target = args[0];

    // Interactive mode: select from list
    if (!target) {
        console.log(`\n  ${chalk.bold.cyan('🔄 アカウント切り替え')}`);
        console.log(`  ${chalk.dim('使用するアカウントを選択してください')}\n`);

        for (let i = 0; i < names.length; i++) {
            const uname = names[i];
            const isActive = uname === activeUsername;
            const hasToken = full.accounts[uname]?.token ? chalk.green('✓') : chalk.dim('○');
            const activeMark = isActive ? chalk.cyan(' ← 現在') : '';
            console.log(`  ${chalk.cyan(`${i + 1}.`)} ${chalk.bold(isActive ? uname : uname)} ${hasToken}${activeMark}`);
        }
        console.log(`  ${chalk.dim('  0.')} ${chalk.dim('キャンセル')}`);
        console.log();

        const rl = createInterface({ input, output });
        let selected = null;

        while (selected === null) {
            const answer = await rl.question(`  ${chalk.bold('番号を選択 (1-' + names.length + '):')} `);
            const num = parseInt(answer.trim(), 10);

            if (answer.trim() === '0') {
                rl.close();
                console.log(chalk.yellow('\n  キャンセルしました。'));
                return;
            }

            if (isNaN(num) || num < 1 || num > names.length) {
                console.log(`  ${chalk.red(`✖ 無効な番号です。1〜${names.length} の番号を入力してください。`)}`);
                continue;
            }

            selected = names[num - 1];
        }
        rl.close();

        target = selected;
    }

    // Check if the target account exists
    if (!full.accounts[target]) {
        console.error(chalk.red(`✖ アカウント「${target}」が見つかりません。`));
        console.error(chalk.dim('  kb accounts  で保存済みアカウントを確認できます。'));
        process.exit(1);
    }

    if (target === activeUsername) {
        console.log(`\n  ${chalk.dim(`すでに @${target} がアクティブです。`)}`);
        return;
    }

    // Switch
    full.activeUsername = target;
    await saveFullConfig(full);

    const acct = full.accounts[target];
    const hasToken = acct && acct.token;

    console.log(`\n  ${chalk.green('✓')} ${chalk.bold.cyan(`@${target}`)} ${chalk.dim('に切り替えました。')}`);

    if (!hasToken) {
        console.log(`  ${chalk.yellow('⚠️  このアカウントはまだログインしていません。')}`);
        console.log(`  ${chalk.dim('  kb login     でログイン')}`);
    }
    console.log(`  ${chalk.dim('  kb whoami    で現在のアカウント確認')}`);
    console.log(`  ${chalk.dim('  kb accounts  でアカウント一覧')}`);
}

// ============================================================================
// Command: account (subcommands: remove)
// ============================================================================
async function cmdAccount(args) {
    const sub = args[0];

    if (!sub || sub === 'help') {
        console.log(`\n  ${chalk.bold.cyan('👤 アカウント管理')}`);
        console.log(`  ${chalk.dim('─'.repeat(40))}`);
        console.log(`  ${chalk.cyan('kb account remove <username>')}   アカウントを削除`);
        console.log(`  ${chalk.cyan('kb account list')}                アカウント一覧 (kb accounts)`);
        console.log();
        return;
    }

    switch (sub) {
        case 'remove':
        case 'rm':
        case 'delete':
            await cmdAccountRemove(args.slice(1));
            break;
        case 'list':
        case 'ls':
            await cmdAccounts();
            break;
        default:
            console.error(chalk.red(`✖ 不明なサブコマンド: "${sub}"`));
            process.exit(1);
    }
}

// ============================================================================
// Command: account remove (delete a saved account from config)
// ============================================================================
async function cmdAccountRemove(args) {
    const { full, activeUsername } = getConfigBundle();
    const names = listAccountNames();

    if (names.length === 0) {
        console.error(chalk.red('✖ 保存されたアカウントがありません。'));
        process.exit(1);
    }

    let target = args[0];

    // Interactive mode
    if (!target) {
        console.log(`\n  ${chalk.bold.cyan('🗑️ 削除するアカウントを選択')}`);
        console.log(`  ${chalk.red('⚠️  ローカル設定からのみ削除され、サーバーのデータは残ります。')}\n`);

        for (let i = 0; i < names.length; i++) {
            const uname = names[i];
            const isActive = uname === activeUsername;
            const activeMark = isActive ? chalk.cyan(' ← 現在') : '';
            console.log(`  ${chalk.cyan(`${i + 1}.`)} ${uname}${activeMark}`);
        }
        console.log(`  ${chalk.dim('  0.')} ${chalk.dim('キャンセル')}`);
        console.log();

        const rl = createInterface({ input, output });
        let selected = null;

        while (selected === null) {
            const answer = await rl.question(`  ${chalk.bold('番号を選択 (1-' + names.length + '):')} `);
            const num = parseInt(answer.trim(), 10);

            if (answer.trim() === '0') {
                rl.close();
                console.log(chalk.yellow('\n  キャンセルしました。'));
                return;
            }

            if (isNaN(num) || num < 1 || num > names.length) {
                console.log(`  ${chalk.red(`✖ 無効な番号です。1〜${names.length} の番号を入力してください。`)}`);
                continue;
            }

            selected = names[num - 1];
        }
        rl.close();

        target = selected;
    }

    if (!full.accounts[target]) {
        console.error(chalk.red(`✖ アカウント「${target}」が見つかりません。`));
        process.exit(1);
    }

    // Confirm
    const confirmed = await confirmPrompt(`@${target} をローカル設定から削除してもよろしいですか？`);
    if (!confirmed) {
        console.log(chalk.yellow('\n  キャンセルしました。'));
        return;
    }

    delete full.accounts[target];

    // If we removed the active account, switch to another
    if (activeUsername === target) {
        const remaining = Object.keys(full.accounts);
        full.activeUsername = remaining.length > 0 ? remaining[0] : null;
    }

    await saveFullConfig(full);

    console.log(`\n  ${chalk.green('✓')} @${target} ${chalk.dim('をローカル設定から削除しました。')}`);

    if (full.activeUsername && full.activeUsername !== target) {
        console.log(`  ${chalk.dim(`現在のアカウント: @${full.activeUsername}`)}`);
    }
}

// ============================================================================
// Nostr command system
// ============================================================================

async function cmdNostr(args) {
    const sub = args[0];

    if (!sub || sub === 'help' || sub === '--help') {
        showNostrHelp();
        return;
    }

    switch (sub) {
        case 'key':
        case 'keys':
            await cmdNostrKey(args.slice(1));
            break;
        case 'relay':
        case 'relays':
            await cmdNostrRelay(args.slice(1));
            break;
        case 'push':
            await cmdNostrPush(args.slice(1));
            break;
        case 'pull':
            await cmdNostrPull(args.slice(1));
            break;
        case 'pubkey':
        case 'npub':
            cmdNostrPubkey();
            break;
        case 'test':
            await cmdNostrTestRelay(args.slice(1));
            break;
        case 'status':
            cmdNostrStatus();
            break;
        default:
            console.error(chalk.red(`✖ 不明な Nostr サブコマンド: "${sub}"`));
            console.log(chalk.dim('  kb nostr help  で使い方を表示'));
            process.exit(1);
    }
}

function showNostrHelp() {
    console.log(`\n  ${chalk.bold.cyan('🔑 Nostr 統合 (v2.0.1)')}`);
    console.log(`  ${chalk.dim('koshi を Nostr プロトコルと連携')}`);
    console.log(`  ${chalk.dim('─'.repeat(50))}`);
    console.log();
    console.log(`  ${chalk.bold('🔐 鍵管理')}`);
    console.log(`    ${chalk.cyan('kb nostr key generate')}     新規 Nostr 鍵ペアを生成`);
    console.log(`    ${chalk.cyan('kb nostr key show')}          現在の Nostr 公開鍵を表示`);
    console.log(`    ${chalk.cyan('kb nostr key import <nsec>')} 既存の nsec 秘密鍵をインポート`);
    console.log();
    console.log(`  ${chalk.bold('🌐 リレー管理')}`);
    console.log(`    ${chalk.cyan('kb nostr relay list')}        リレー一覧`);
    console.log(`    ${chalk.cyan('kb nostr relay add <url>')}   リレーを追加`);
    console.log(`    ${chalk.cyan('kb nostr relay remove <url>')} リレーを削除`);
    console.log(`    ${chalk.cyan('kb nostr relay test <url>')}  リレーの接続をテスト`);
    console.log();
    console.log(`  ${chalk.bold('📡 同期')}`);
    console.log(`    ${chalk.cyan('kb nostr push [--limit=20]')} 投稿を Nostr に公開`);
    console.log(`    ${chalk.cyan('kb nostr pull [--limit=50]')} Nostr から投稿を取得`);
    console.log();
    console.log(`  ${chalk.bold('ℹ️  情報')}`);
    console.log(`    ${chalk.cyan('kb nostr status')}           Nostr 設定状況を表示`);
    console.log(`    ${chalk.cyan('kb nostr npub')}             公開鍵 (npub) を表示`);
    console.log();
}

// ---------------------------------------------------------------------------
// kb nostr key generate | show | import
// ---------------------------------------------------------------------------

async function cmdNostrKey(args) {
    const sub = args[0];

    if (!sub || sub === 'help') {
        console.log(`\n  ${chalk.bold.cyan('🔐 Nostr 鍵管理')}`);
        console.log(`  ${chalk.dim('─'.repeat(40))}`);
        console.log(`  ${chalk.cyan('kb nostr key generate')}     新規鍵ペアを生成`);
        console.log(`  ${chalk.cyan('kb nostr key show')}          現在の鍵を表示`);
        console.log(`  ${chalk.cyan('kb nostr key import <nsec>')} 既存鍵をインポート`);
        console.log();
        return;
    }

    switch (sub) {
        case 'generate':
        case 'gen':
        case 'new':
            await cmdNostrKeyGenerate();
            break;
        case 'show':
        case 'info':
            await cmdNostrKeyShow();
            break;
        case 'import':
        case 'restore':
            await cmdNostrKeyImport(args.slice(1));
            break;
        default:
            console.error(chalk.red(`✖ 不明な鍵サブコマンド: "${sub}"`));
            process.exit(1);
    }
}

async function cmdNostrKeyGenerate() {
    const config = getActiveConfig();
    if (!config.username) {
        console.error(chalk.red('✖ ログインしていません。先に kb register または kb login してください。'));
        process.exit(1);
    }

    const spinner = ora('Generating Nostr keypair...').start();

    try {
        const { generateNostrKeypair } = await import('../src/nostr/index.js');
        const kp = generateNostrKeypair();

        spinner.text = 'Saving to config...';

        const { full } = getConfigBundle();
        const acct = full.accounts[config.username];
        if (!acct) {
            spinner.fail(chalk.red('Account not found in config.'));
            process.exit(1);
        }

        acct.nostr = {
            nsec: kp.nsec,
            npub: kp.npub,
            relays: ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol', 'wss://relay.snort.social'],
            lastPushAt: null,
            lastPullAt: null,
        };
        await saveFullConfig(full);

        spinner.succeed(chalk.green('Nostr keypair generated and saved!'));

        console.log(`\n  ${chalk.bold('🔑 Nostr Keys')}`);
        console.log(`  ${chalk.dim('─'.repeat(50))}`);
        console.log(`  ${chalk.bold('npub:')}  ${chalk.cyan(kp.npub)}`);
        console.log(`  ${chalk.bold('nsec:')}  ${chalk.yellow(kp.nsec)}`);
        console.log(`  ${chalk.dim('  ⚠️  nsec（秘密鍵）は他人と共有しないでください！')}`);
        console.log(`\n  ${chalk.dim('💡 Nostr に投稿を公開:')} ${chalk.italic('kb nostr push')}`);
        console.log(`  ${chalk.dim('💡 Nostr から投稿を取得:')} ${chalk.italic('kb nostr pull')}`);
    } catch (err) {
        spinner.fail(chalk.red(`Failed: ${err.message}`));
        process.exit(1);
    }
}

async function cmdNostrKeyShow() {
    const config = getActiveConfig();
    if (!config.username || !config.nostr?.nsec) {
        console.error(chalk.red('✖ Nostr 鍵が設定されていません。'));
        console.error(chalk.dim('  kb nostr key generate  で新規生成'));
        console.error(chalk.dim('  kb nostr key import <nsec>  でインポート'));
        process.exit(1);
    }

    const nc = config.nostr;
    const relayCount = nc.relays?.length || 0;

    console.log(`\n  ${chalk.bold.cyan('🔑 Nostr Keys')}`);
    console.log(`  ${chalk.dim('─'.repeat(50))}`);
    console.log(`  ${chalk.bold('npub:')}  ${chalk.cyan(nc.npub || 'N/A')}`);
    console.log(`  ${chalk.bold('nsec:')}  ${chalk.dim(nc.nsec ? nc.nsec.slice(0, 12) + '...' : 'N/A')}`);
    console.log(`  ${chalk.bold('Relays:')} ${chalk.dim(relayCount + ' 件設定')}`);

    if (nc.relays?.length > 0) {
        console.log();
        for (const relay of nc.relays) {
            console.log(`    ${chalk.dim('•')} ${chalk.dim(relay)}`);
        }
    }

    console.log(`\n  ${chalk.bold('Sync Status:')}`);
    console.log(`    ${chalk.dim('Last Push:')} ${nc.lastPushAt ? new Date(nc.lastPushAt).toLocaleString() : chalk.dim('まだ')}`);
    console.log(`    ${chalk.dim('Last Pull:')} ${nc.lastPullAt ? new Date(nc.lastPullAt).toLocaleString() : chalk.dim('まだ')}`);
}

async function cmdNostrKeyImport(args) {
    const nsec = args[0];
    if (!nsec) {
        console.error(chalk.red('✖ nsec を指定してください。'));
        console.error(chalk.dim('  kb nostr key import nsec1...'));
        process.exit(1);
    }

    const config = getActiveConfig();
    if (!config.username) {
        console.error(chalk.red('✖ ログインしていません。'));
        process.exit(1);
    }

    const spinner = ora('Importing Nostr key...').start();

    try {
        const { importNostrKey } = await import('../src/nostr/index.js');
        const kp = importNostrKey(nsec);

        spinner.text = 'Saving to config...';

        const { full } = getConfigBundle();
        const acct = full.accounts[config.username];
        if (!acct) {
            spinner.fail(chalk.red('Account not found.'));
            process.exit(1);
        }

        acct.nostr = {
            nsec: kp.nsec,
            npub: kp.npub,
            relays: acct.nostr?.relays || ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol'],
            lastPushAt: acct.nostr?.lastPushAt || null,
            lastPullAt: acct.nostr?.lastPullAt || null,
        };
        await saveFullConfig(full);

        spinner.succeed(chalk.green('Nostr key imported!'));
        console.log(`\n  ${chalk.bold('npub:')}  ${chalk.cyan(kp.npub)}`);
    } catch (err) {
        spinner.fail(chalk.red(`Import failed: ${err.message}`));
        process.exit(1);
    }
}

function cmdNostrPubkey() {
    const config = getActiveConfig();
    if (!config.nostr?.npub) {
        console.error(chalk.red('✖ Nostr 公開鍵が設定されていません。'));
        process.exit(1);
    }
    console.log(`\n  ${chalk.cyan(config.nostr.npub)}`);
}

// ---------------------------------------------------------------------------
// kb nostr relay
// ---------------------------------------------------------------------------

async function cmdNostrRelay(args) {
    const sub = args[0];

    if (!sub || sub === 'help' || sub === 'list') {
        await cmdNostrRelayList();
        return;
    }

    switch (sub) {
        case 'add':
            await cmdNostrRelayAdd(args.slice(1));
            break;
        case 'remove':
        case 'rm':
        case 'delete':
            await cmdNostrRelayRemove(args.slice(1));
            break;
        case 'test':
            await cmdNostrTestRelay(args.slice(1));
            break;
        default:
            console.error(chalk.red(`✖ 不明なリレーサブコマンド: "${sub}"`));
            process.exit(1);
    }
}

async function cmdNostrRelayList() {
    const config = getActiveConfig();
    const relays = config.nostr?.relays || [];

    if (relays.length === 0) {
        console.log(`\n  ${chalk.dim('リレーが設定されていません。')}`);
        console.log(`  ${chalk.dim('kb nostr relay add wss://relay.damus.io  で追加')}`);
        return;
    }

    console.log(`\n  ${chalk.bold.cyan('🌐 Nostr Relays')} ${chalk.dim(`(${relays.length}件)`)}`);
    console.log(`  ${chalk.dim('─'.repeat(50))}`);

    for (let i = 0; i < relays.length; i++) {
        console.log(`  ${chalk.cyan(`${i + 1}.`)} ${chalk.dim(relays[i])}`);
    }

    console.log(`\n  ${chalk.dim('💡 追加:')} ${chalk.italic('kb nostr relay add <url>')}`);
    console.log(`  ${chalk.dim('💡 削除:')} ${chalk.italic('kb nostr relay remove <url>')}`);
    console.log(`  ${chalk.dim('💡 テスト:')} ${chalk.italic('kb nostr relay test <url>')}`);
}

async function cmdNostrRelayAdd(args) {
    const url = args[0];
    if (!url) {
        console.error(chalk.red('✖ リレーURLを指定してください。'));
        console.error(chalk.dim('  kb nostr relay add wss://relay.example.com'));
        process.exit(1);
    }

    try {
        const { addRelay } = await import('../src/nostr/index.js');
        await addRelay(url);
        console.log(`\n  ${chalk.green('✓')} リレーを追加しました: ${chalk.cyan(url)}`);
    } catch (err) {
        console.error(chalk.red(`✖ 追加失敗: ${err.message}`));
        process.exit(1);
    }
}

async function cmdNostrRelayRemove(args) {
    const url = args[0];
    if (!url) {
        console.error(chalk.red('✖ リレーURLを指定してください。'));
        console.error(chalk.dim('  kb nostr relay remove wss://relay.example.com'));
        process.exit(1);
    }

    try {
        const { removeRelay } = await import('../src/nostr/index.js');
        await removeRelay(url);
        console.log(`\n  ${chalk.green('✓')} リレーを削除しました: ${chalk.cyan(url)}`);
    } catch (err) {
        console.error(chalk.red(`✖ 削除失敗: ${err.message}`));
        process.exit(1);
    }
}

async function cmdNostrTestRelay(args) {
    let url = args[0];

    if (!url) {
        // Interactive: pick from configured relays
        const config = getActiveConfig();
        const relays = config.nostr?.relays || [];

        if (relays.length === 0) {
            console.error(chalk.red('✖ リレーが設定されていません。'));
            process.exit(1);
        }

        const selected = await selectFromList(
            relays.map((r) => ({ url: r })),
            (r) => r.url,
            'テストするリレーを選択:'
        );

        if (!selected) {
            console.log(chalk.yellow('\n  キャンセルしました。'));
            return;
        }

        url = selected.url;
    }

    const spinner = ora(`Testing relay ${url}...`).start();

    try {
        const { testRelay } = await import('../src/nostr/index.js');
        const result = await testRelay(url);

        if (result.ok) {
            spinner.succeed(chalk.green(`✓ ${url}`));
            console.log(`  ${chalk.dim('Latency:')} ${chalk.cyan(result.latencyMs + 'ms')}`);
        } else {
            spinner.fail(chalk.red(`✗ ${url}`));
            console.log(`  ${chalk.dim('Error:')} ${chalk.red(result.error)}`);
        }
    } catch (err) {
        spinner.fail(chalk.red(`✗ ${url}`));
        console.log(`  ${chalk.dim('Error:')} ${chalk.red(err.message)}`);
    }
}

// ---------------------------------------------------------------------------
// kb nostr push
// ---------------------------------------------------------------------------

async function cmdNostrPush(args) {
    const config = getActiveConfig();
    if (!config.token) {
        console.error(chalk.red('✖ ログインしていません。'));
        process.exit(1);
    }

    if (!config.nostr?.nsec) {
        console.error(chalk.red('✖ Nostr 鍵が設定されていません。'));
        console.error(chalk.dim('  kb nostr key generate  で鍵を生成してください。'));
        process.exit(1);
    }

    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 20;

    const spinner = ora(`Fetching ${limit} recent posts...`).start();

    try {
        // Fetch recent posts
        const posts = await apiRequest('GET', `/api/posts/feed?limit=${limit}`, null, config.token);
        spinner.text = `Publishing ${posts.length} posts to Nostr...`;

        const { pushPostsToNostr, decodeNsec } = await import('../src/nostr/index.js');
        const secretKey = decodeNsec(config.nostr.nsec);
        const result = await pushPostsToNostr(posts, secretKey, config.nostr.relays);

        if (result.published > 0) {
            spinner.succeed(chalk.green(`${result.published}/${posts.length} posts published to Nostr!`));
        } else {
            spinner.fail(chalk.yellow('No posts could be published. Check relay connectivity.'));
        }

        // Show per-relay results
        const relayResults = new Map();
        for (const r of result.results) {
            for (const pr of r.pubResults) {
                if (!relayResults.has(pr.url)) {
                    relayResults.set(pr.url, { ok: 0, fail: 0 });
                }
                const stats = relayResults.get(pr.url);
                if (pr.ok) stats.ok++;
                else stats.fail++;
            }
        }

        console.log(`\n  ${chalk.bold('📡 Relay Results')}:`);
        for (const [url, stats] of relayResults) {
            const status = stats.fail === 0
                ? chalk.green(`✓ ${stats.ok} published`)
                : chalk.yellow(`⚠ ${stats.ok} ok, ${stats.fail} failed`);
            console.log(`    ${chalk.dim('•')} ${url} ${status}`);
        }

        console.log(`\n  ${chalk.dim('💡 Nostr から取得:')} ${chalk.italic('kb nostr pull')}`);
    } catch (err) {
        spinner.fail(chalk.red(`Push failed: ${err.message}`));
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// kb nostr pull
// ---------------------------------------------------------------------------

async function cmdNostrPull(args) {
    const config = getActiveConfig();
    if (!config.token) {
        console.error(chalk.red('✖ ログインしていません。'));
        process.exit(1);
    }

    if (!config.nostr?.relays || config.nostr.relays.length === 0) {
        console.error(chalk.red('✖ リレーが設定されていません。'));
        process.exit(1);
    }

    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 50;

    const spinner = ora(`Pulling from ${config.nostr.relays.length} Nostr relays...`).start();

    try {
        const { pullPostsFromNostr } = await import('../src/nostr/index.js');

        let secretKey;
        if (config.nostr?.nsec) {
            const { decodeNsec } = await import('../src/nostr/index.js');
            secretKey = decodeNsec(config.nostr.nsec);
        }

        const result = await pullPostsFromNostr(limit, secretKey, config.nostr.relays);

        if (result.total === 0) {
            spinner.info(chalk.dim('No Nostr events found for your key.'));
            return;
        }

        spinner.succeed(chalk.green(`Found ${result.total} Nostr events!`));

        console.log(`\n  ${chalk.bold.cyan('📡 Nostr Events')} ${chalk.dim(`(${result.total}件)`)}`);
        console.log(`  ${chalk.dim('─'.repeat(60))}\n`);

        for (const post of result.posts.slice(0, 20)) {
            const time = new Date(post.createdAt).toLocaleString();
            console.log(`  ${chalk.bold(post.author.username)} ${chalk.dim(time)}`);
            console.log(`  ${post.content.slice(0, 200)}`);
            console.log(`  ${chalk.dim('─'.repeat(60))}\n`);
        }

        if (result.posts.length > 20) {
            console.log(`  ${chalk.dim('...and')} ${result.posts.length - 20} ${chalk.dim('more events.')}`);
            console.log(`  ${chalk.dim('💡 Use --limit=100 to get more.')}`);
        }
    } catch (err) {
        spinner.fail(chalk.red(`Pull failed: ${err.message}`));
        process.exit(1);
    }
}

// ---------------------------------------------------------------------------
// kb nostr status
// ---------------------------------------------------------------------------

function cmdNostrStatus() {
    const config = getActiveConfig();

    console.log(`\n  ${chalk.bold.cyan('🔑 Nostr Status')}`);
    console.log(`  ${chalk.dim('─'.repeat(50))}`);

    if (config.nostr?.nsec) {
        console.log(`  ${chalk.bold('Keys:')}      ${chalk.green('✓ Configured')}`);
        console.log(`  ${chalk.bold('npub:')}     ${chalk.cyan(config.nostr.npub || 'N/A')}`);
    } else {
        console.log(`  ${chalk.bold('Keys:')}      ${chalk.red('✖ Not configured')}`);
        console.log(`  ${chalk.dim('  Run: kb nostr key generate')}`);
    }

    const relays = config.nostr?.relays || [];
    if (relays.length > 0) {
        console.log(`  ${chalk.bold('Relays:')}    ${chalk.green('✓')} ${relays.length} configured`);
        for (const r of relays) {
            console.log(`                ${chalk.dim(r)}`);
        }
    } else {
        console.log(`  ${chalk.bold('Relays:')}    ${chalk.yellow('○ None configured')}`);
    }

    if (config.nostr?.lastPushAt) {
        console.log(`  ${chalk.bold('Last Push:')} ${chalk.dim(new Date(config.nostr.lastPushAt).toLocaleString())}`);
    }
    if (config.nostr?.lastPullAt) {
        console.log(`  ${chalk.bold('Last Pull:')} ${chalk.dim(new Date(config.nostr.lastPullAt).toLocaleString())}`);
    }

    console.log();
}

// ============================================================================
// P2P command system
// ============================================================================

async function cmdP2P(args) {
    const sub = args[0];

    if (!sub || sub === 'help' || sub === '--help') {
        showP2PHelp();
        return;
    }

    switch (sub) {
        case 'start':
            await cmdP2PStart(args.slice(1));
            break;
        case 'stop':
            await cmdP2PStop();
            break;
        case 'status':
            await cmdP2PStatus();
            break;
        case 'sync':
        case 'posts':
            await cmdP2PSync(args.slice(1));
            break;
        case 'dms':
            await cmdP2PDMs(args.slice(1));
            break;
        default:
            console.error(chalk.red(`✖ 不明な P2P サブコマンド: "${sub}"`));
            console.log(chalk.dim('  kb p2p help  で使い方を表示'));
            process.exit(1);
    }
}

function showP2PHelp() {
    console.log(`\n  ${chalk.bold.cyan('🖧 P2P 同期 (hypercore + hyperswarm)')}`);
    console.log(`  ${chalk.dim('koshi の P2P ノード管理')}`);
    console.log(`  ${chalk.dim('─'.repeat(50))}`);
    console.log();
    console.log(`  ${chalk.bold('🔄 ノード管理')}`);
    console.log(`    ${chalk.cyan('kb p2p start')}            P2P ノードを起動`);
    console.log(`    ${chalk.cyan('kb p2p stop')}             P2P ノードを停止`);
    console.log(`    ${chalk.cyan('kb p2p status')}           P2P ノードの状態を表示`);
    console.log();
    console.log(`  ${chalk.bold('📦 データ')}`);
    console.log(`    ${chalk.cyan('kb p2p sync')}             同期済み投稿を表示`);
    console.log(`    ${chalk.cyan('kb p2p dms')}              同期済みDMを表示`);
    console.log();
    console.log(`  ${chalk.dim('設定ファイル: ~/.config/koshi/config.json')}`);
    console.log(`  ${chalk.dim('  "p2p": { "autoSync": true } で自動起動')}`);
    console.log();
}

async function cmdP2PStart(args) {
    const config = getActiveConfig();
    if (!config.userId || !config.publicKey) {
        console.error(chalk.red('✖ ログインしていません。先に kb register または kb login してください。'));
        process.exit(1);
    }

    const spinner = ora('Starting P2P node...').start();

    try {
        const { initP2PNode, getP2PStatus } = await import('../src/p2p/index.js');
        const ok = await initP2PNode();

        if (ok) {
            const status = getP2PStatus();
            spinner.succeed(chalk.green('P2P node started!'));
            console.log(`\n  ${chalk.bold('Status:')}     ${chalk.green('Running')}`);
            console.log(`  ${chalk.bold('Posts:')}      ${chalk.cyan(status.posts)}`);
            console.log(`  ${chalk.bold('DMs:')}         ${chalk.cyan(status.dms)}`);
            console.log(`  ${chalk.bold('Peers:')}       ${chalk.cyan(status.peers)}`);
            console.log(`\n  ${chalk.dim('KB p2p status  で状態確認')}`);
            console.log(`  ${chalk.dim('kb p2p stop    で停止')}`);
        } else {
            spinner.fail(chalk.red('Failed to start P2P node. Is the database connected?'));
        }
    } catch (err) {
        spinner.fail(chalk.red(`Failed: ${err.message}`));
        process.exit(1);
    }
}

async function cmdP2PStop() {
    const spinner = ora('Stopping P2P node...').start();

    try {
        const { closeP2PNode } = await import('../src/p2p/index.js');
        await closeP2PNode();
        spinner.succeed(chalk.yellow('P2P node stopped.'));
    } catch (err) {
        spinner.fail(chalk.red(`Failed: ${err.message}`));
        process.exit(1);
    }
}

async function cmdP2PStatus() {
    const { getP2PStatus } = await import('../src/p2p/index.js');
    const status = getP2PStatus();

    if (!status.ready) {
        console.log(`\n  ${chalk.dim('P2P ノードは停止しています。')}`);
        console.log(`  ${chalk.dim('kb p2p start  で起動')}`);
        return;
    }

    console.log(`\n  ${chalk.bold.cyan('🖧 P2P Node Status')}`);
    console.log(`  ${chalk.dim('─'.repeat(50))}`);
    console.log(`  ${chalk.bold('Status:')}     ${chalk.green('Running')}`);
    console.log(`  ${chalk.bold('Posts:')}      ${chalk.cyan(status.posts)} 件`);
    console.log(`  ${chalk.bold('DMs:')}         ${chalk.cyan(status.dms)} 件`);
    console.log(`  ${chalk.bold('Connected:')}   ${chalk.cyan(status.peers)} peers`);

    if (status.info) {
        console.log(`  ${chalk.bold('Username:')}   ${chalk.dim(status.info.username)}`);
        console.log(`  ${chalk.bold('Discovery:')}  ${chalk.dim(status.info.discoveryKey)}`);
        console.log(`  ${chalk.bold('Storage:')}    ${chalk.dim(status.info.corestorePath)}`);
    }

    console.log();
}

async function cmdP2PSync(args) {
    const { getP2PStatus, getPosts } = await import('../src/p2p/index.js');
    const status = getP2PStatus();

    if (!status.ready) {
        console.error(chalk.red('✖ P2P ノードが起動していません。'));
        console.error(chalk.dim('  kb p2p start'));
        process.exit(1);
    }

    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 20;
    const posts = await getPosts();

    if (posts.length === 0) {
        console.log(`\n  ${chalk.dim('同期済みの投稿はありません。')}`);
        return;
    }

    console.log(`\n  ${chalk.bold.cyan('📡 P2P Synced Posts')} ${chalk.dim(`(${Math.min(posts.length, limit)} 件)`)}`);
    console.log(`  ${chalk.dim('─'.repeat(60))}\n`);

    for (const post of posts.slice(0, limit)) {
        const time = post.createdAt ? new Date(post.createdAt).toLocaleString() : '?';
        console.log(`  ${chalk.bold(post.username || 'unknown')} ${chalk.dim(time)}`);
        console.log(`  ${(post.content || '').slice(0, 200)}`);
        console.log(`  ${chalk.dim('─'.repeat(60))}\n`);
    }
}

async function cmdP2PDMs(args) {
    const { getP2PStatus, getDMs } = await import('../src/p2p/index.js');
    const status = getP2PStatus();

    if (!status.ready) {
        console.error(chalk.red('✖ P2P ノードが起動していません。'));
        process.exit(1);
    }

    const limit = parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 20;
    const dms = await getDMs();

    if (dms.length === 0) {
        console.log(`\n  ${chalk.dim('同期済みのDMはありません。')}`);
        return;
    }

    console.log(`\n  ${chalk.bold.cyan('✉️ P2P Synced DMs')} ${chalk.dim(`(${Math.min(dms.length, limit)} 件)`)}`);
    console.log(`  ${chalk.dim('─'.repeat(60))}\n`);

    for (const dm of dms.slice(0, limit)) {
        const time = dm.createdAt ? new Date(dm.createdAt).toLocaleString() : '?';
        console.log(`  ${chalk.bold(dm.fromUsername || '?')} → ${chalk.bold(dm.toUsername || '?')} ${chalk.dim(time)}`);
        console.log(`  ${(dm.content || '').slice(0, 200)}`);
        console.log(`  ${chalk.dim('─'.repeat(60))}\n`);
    }
}

// ============================================================================
// Command: help
// ============================================================================
function showHelp(command = null) {
    const commands = {
        // Account management
        register: {
            usage: 'kb register [username]',
            desc: '新規アカウント登録（引数なしで対話式）',
        },
        login: {
            usage: 'kb login [username]',
            desc: 'ログイン（引数なしでアカウント一覧から選択）',
        },
        switch: {
            usage: 'kb switch [username]',
            desc: '保存済みアカウントを切り替え（対話式）',
        },
        accounts: {
            usage: 'kb accounts',
            desc: '保存済みアカウント一覧',
        },
        'account': {
            usage: 'kb account remove <username>',
            desc: 'アカウントをローカル設定から削除',
        },
        whoami: {
            usage: 'kb whoami',
            desc: '現在のアカウント情報を表示',
        },
        // Posts & Feed
        post: {
            usage: 'kb post [message]',
            desc: '投稿する（引数なしで対話式入力）',
        },
        feed: {
            usage: 'kb feed [--limit=20]',
            desc: 'フィードを表示',
        },
        // Social
        follow: {
            usage: 'kb follow [username]',
            desc: 'フォロー（引数なしで検索→選択）',
        },
        unfollow: {
            usage: 'kb unfollow [username]',
            desc: 'アンフォロー（引数なしで検索→選択）',
        },
        profile: {
            usage: 'kb profile [username]',
            desc: 'プロフィール表示（引数なしで検索→選択）',
        },
        'edit-profile': {
            usage: 'kb edit-profile [--display-name=...]',
            desc: 'プロフィール編集（引数なしで対話式）',
        },
        search: {
            usage: 'kb search [query]',
            desc: 'ユーザー検索（引数なしで対話式）',
        },
        // Direct Messages
        dm: {
            usage: 'kb dm [username] [message]',
            desc: 'DM送信（引数なしで検索→対話式入力）',
        },
        dms: {
            usage: 'kb dms [--unread] [--limit=50]',
            desc: 'DM受信箱を表示',
        },
        chat: {
            usage: 'kb chat [username]',
            desc: 'リアルタイムDMチャット（引数なしで検索）',
        },
        // Nostr
        nostr: {
            usage: 'kb nostr <command>',
            desc: 'Nostr 統合（鍵・リレー・同期）',
        },
        // P2P
        p2p: {
            usage: 'kb p2p <command>',
            desc: 'P2P 同期（hypercore + hyperswarm）',
        },
        // Other
        realtime: {
            usage: 'kb realtime',
            desc: 'リアルタイムフィードをストリーム表示',
        },
        admin: {
            usage: 'kb admin <command>',
            desc: '管理者コマンド',
        },
        help: {
            usage: 'kb help [command]',
            desc: 'ヘルプを表示',
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

    // Show active account info in help
    const { activeUsername } = getConfigBundle();
    const activeInfo = activeUsername
        ? `  ${chalk.green('●')} ${chalk.bold.cyan(`@${activeUsername}`)} ${chalk.dim('(アクティブ)')}`
        : `  ${chalk.red('○')} ${chalk.dim('ログインしていません')}`;

    console.log(`\n  ${chalk.bold.cyan('🏄 koshi — Terminal-Native Decentralized SNS')}`);
    console.log(`  ${chalk.dim('Version 2.0.1 — Nostr/P2P 統合')}`);
    console.log(`\n  ${activeInfo}`);
    console.log(`\n  ${chalk.bold('Usage:')} kb <command> [options]\n`);

    // Group commands by category
    const groups = [
        {
            title: '👤 アカウント管理',
            keys: ['register', 'login', 'switch', 'accounts', 'account', 'whoami'],
        },
        {
            title: '📝 投稿',
            keys: ['post', 'feed'],
        },
        {
            title: '👥 ソーシャル',
            keys: ['follow', 'unfollow', 'profile', 'edit-profile', 'search'],
        },
        {
            title: '✉️ DM',
            keys: ['dm', 'dms', 'chat'],
        },
        {
            title: '🔑 Nostr',
            keys: ['nostr'],
        },
        {
            title: '🖧 P2P',
            keys: ['p2p'],
        },
        {
            title: '⚙️ その他',
            keys: ['realtime', 'admin', 'help'],
        },
    ];

    const maxLen = Math.max(...Object.values(commands).map((c) => c.usage.length));

    for (const group of groups) {
        console.log(`  ${chalk.bold(group.title)}`);
        for (const key of group.keys) {
            const cmd = commands[key];
            if (!cmd) continue;
            const padding = ' '.repeat(maxLen - cmd.usage.length + 2);
            console.log(`    ${chalk.cyan(cmd.usage)}${padding}${chalk.dim(cmd.desc)}`);
        }
        console.log();
    }

    console.log(`  ${chalk.bold('Options:')}`);
    console.log(`    --help, -h    Show help for a command`);
    console.log(`    --version, -v Show version`);
    console.log(`\n  ${chalk.dim('環境変数:')}`);
    console.log(`    ${chalk.dim('KOSHI_API_URL   API base URL (default: https://koshi-api.ryopc.f5.si)')}`);
    console.log(`    ${chalk.dim('KOSHI_WS_URL    WebSocket URL (default: wss://koshi-api.ryopc.f5.si)')}`);
    console.log();
}

// ============================================================================
// Command: version
// ============================================================================
function showVersion() {
    console.log('koshi v2.0.2' + (IS_LOCAL ? ' (local mode)' : ''));
    console.log('Terminal-native decentralized SNS — Nostr/P2P 統合');
    console.log('License: MIT');
    console.log('Author: game_ryo');
    console.log('Website: https://koshi.js.org');
}

// ============================================================================
// Command: admin
// ============================================================================
async function cmdAdmin(args) {
    const config = getActiveConfig();
    if (!config.token) {
        console.error(chalk.red('✖ Not logged in. Admin commands require authentication.'));
        process.exit(1);
    }

    const subcommand = args[0];

    if (!subcommand || subcommand === 'help') {
        console.log(`\n  ${chalk.bold.cyan('🛠️  Admin Commands')}`);
        console.log(`  ${chalk.dim('─'.repeat(50))}`);
        console.log(`  ${chalk.cyan('kb admin users')}          List all registered users`);
        console.log(`  ${chalk.cyan('kb admin user <id>')}      View detailed user info`);
        console.log(`  ${chalk.cyan('kb admin delete-user <username>')}  Permanently delete a user account`);
        console.log(`  ${chalk.cyan('kb admin grant <username>')}     Grant admin privileges`);
        console.log(`  ${chalk.cyan('kb admin revoke <username>')}    Revoke admin privileges`);
        console.log(`  ${chalk.dim('─'.repeat(50))}\n`);
        return;
    }

    switch (subcommand) {
        case 'users':
            await cmdAdminUsers(config);
            break;
        case 'user':
            await cmdAdminUserDetail(config, args.slice(1));
            break;
        case 'delete-user':
            await cmdAdminDeleteUser(config, args.slice(1));
            break;
        case 'grant':
            await cmdAdminSetAdmin(config, args.slice(1), true);
            break;
        case 'revoke':
            await cmdAdminSetAdmin(config, args.slice(1), false);
            break;
        default:
            console.error(chalk.red(`✖ Unknown admin command: "${subcommand}"`));
            process.exit(1);
    }
}

async function cmdAdminUsers(config) {
    const spinner = ora('Fetching user list...').start();
    try {
        const data = await apiRequest('GET', '/api/admin/users', null, config.token);
        spinner.stop();

        console.log(`\n  ${chalk.bold.cyan(`👥 All Users (${data.total} total)`)}`);
        console.log(`  ${chalk.dim('─'.repeat(70))}`);

        for (const user of data.users) {
            const adminBadge = user.isAdmin ? chalk.yellow(' [ADMIN]') : '';
            const display = user.displayName || '(no display name)';
            console.log(`  ${chalk.bold(user.username)}${adminBadge} ${chalk.dim(`— ${display}`)}`);
            console.log(`    ${chalk.dim(`ID: ${user.id}  |  Posts: ${user.postsCount}  |  Followers: ${user.followersCount}  |  Joined: ${new Date(user.createdAt).toLocaleDateString()}`)}`);
            console.log();
        }
    } catch (err) {
        spinner.fail(chalk.red(`Failed to list users: ${err.message}`));
        process.exit(1);
    }
}

async function cmdAdminUserDetail(config, args) {
    const userId = args[0];
    if (!userId) {
        console.error(chalk.red('✖ Error: User ID is required. Usage: kb admin user <id>'));
        process.exit(1);
    }

    const spinner = ora('Fetching user details...').start();
    try {
        const data = await apiRequest('GET', `/api/admin/users/${userId}`, null, config.token);
        spinner.stop();

        console.log(`\n  ${chalk.bold.cyan('🔍 User Details')}`);
        console.log(`  ${chalk.dim('─'.repeat(50))}`);
        console.log(`  ${chalk.bold('Username:')}       ${chalk.cyan(data.username)}`);
        console.log(`  ${chalk.bold('ID:')}             ${chalk.dim(data.id)}`);
        console.log(`  ${chalk.bold('Public Key:')}     ${chalk.dim(data.publicKey ? data.publicKey.substring(0, 32) + '...' : 'N/A')}`);
        if (data.displayName) console.log(`  ${chalk.bold('Display Name:')}   ${data.displayName}`);
        if (data.bio) console.log(`  ${chalk.bold('Bio:')}            ${data.bio}`);
        console.log(`  ${chalk.bold('Admin:')}          ${data.isAdmin ? chalk.green('✓ Yes') : chalk.dim('No')}`);
        console.log(`  ${chalk.bold('Posts:')}          ${data.postsCount}`);
        console.log(`  ${chalk.bold('DMs:')}            ${data.dmsCount}`);
        console.log(`  ${chalk.bold('Followers:')}      ${data.followersCount}`);
        console.log(`  ${chalk.bold('Following:')}      ${data.followingCount}`);
        console.log(`  ${chalk.bold('Joined:')}         ${new Date(data.createdAt).toLocaleDateString()}`);
    } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch user: ${err.message}`));
        process.exit(1);
    }
}

async function cmdAdminDeleteUser(config, args) {
    const username = args.find(a => !a.startsWith('--'));
    const force = args.includes('--force');

    if (!username) {
        console.error(chalk.red('✖ Error: Username is required. Usage: kb admin delete-user <username>'));
        process.exit(1);
    }

    if (!force) {
        // Confirm deletion interactively
        console.log(`\n  ${chalk.yellow('⚠️  WARNING: This will permanently delete the user and all their data.')}`);
        console.log(`  ${chalk.yellow('This action cannot be undone.')}\n`);
        console.log(`  ${chalk.bold('Target:')} @${username}`);
        console.log();

        const confirmation = await new Promise((resolve) => {
            process.stdout.write(`  ${chalk.bold('Type the username to confirm')}: `);
            process.stdin.once('data', (buf) => {
                resolve(buf.toString().trim());
            });
        });

        if (confirmation !== username) {
            console.log(chalk.yellow('\n  ✖ Confirmation does not match. Aborted.'));
            process.exit(1);
        }
    }

    const spinner = ora(`Deleting user @${username}...`).start();

    try {
        // Resolve username to ID first
        const userData = await apiRequest('GET', `/api/users/${username}`, null, config.token);

        const result = await apiRequest('DELETE', `/api/admin/users/${userData.id}`, {}, config.token);

        spinner.succeed(chalk.green(`User @${username} has been permanently deleted.`));
    } catch (err) {
        spinner.fail(chalk.red(`Delete failed: ${err.message}`));
        process.exit(1);
    }
}

async function cmdAdminSetAdmin(config, args, makeAdmin) {
    const username = args[0];
    if (!username) {
        const action = makeAdmin ? 'grant' : 'revoke';
        console.error(chalk.red(`✖ Error: Username is required. Usage: kb admin ${action} <username>`));
        process.exit(1);
    }

    const actionLabel = makeAdmin ? 'Granting admin to' : 'Revoking admin from';
    const spinner = ora(`${actionLabel} @${username}...`).start();

    try {
        const userData = await apiRequest('GET', `/api/users/${username}`, null, config.token);

        const result = await apiRequest('PUT', `/api/admin/users/${userData.id}/admin`, {
            isAdmin: makeAdmin,
        }, config.token);

        if (makeAdmin) {
            spinner.succeed(chalk.green(`@${username} is now an admin!`));
        } else {
            spinner.succeed(chalk.yellow(`Admin privileges removed from @${username}.`));
        }
    } catch (err) {
        spinner.fail(chalk.red(`Failed: ${err.message}`));
        process.exit(1);
    }
}

// ============================================================================
// ============================================================================
// Chat bubble TUI helpers
// ============================================================================

/**
 * Wrap text to fit within a given character width.
 */
function wordWrap(text, maxWidth) {
    if (!text || text.length <= maxWidth) return [text || ''];
    const words = text.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
        if ((current + ' ' + word).trim().length > maxWidth) {
            if (current) lines.push(current.trim());
            current = word;
        } else {
            current += (current ? ' ' : '') + word;
        }
    }
    if (current) lines.push(current.trim());
    return lines;
}

/**
 * Render a chat bubble (LINE-style) to the console.
 * Own messages: right-aligned, cyan bubble
 * Received messages: left-aligned, green bubble
 * Timestamps shown next to each bubble group.
 */
function renderChatBubble(isOwn, content, isoTime, showTime) {
    const time = new Date(isoTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const cols = process.stdout.columns || 80;
    const maxBubbleWidth = Math.min(cols - 12, 56);
    const lines = wordWrap(content, maxBubbleWidth);
    const timestamp = chalk.dim(time);

    if (isOwn) {
        // Right-aligned cyan bubble (like LINE's own messages)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const padLeft = Math.max(0, cols - line.length - 16);
            const bTop = chalk.cyan('┌') + chalk.cyan('─'.repeat(line.length + 2)) + chalk.cyan('┐');
            const bMid = chalk.cyan('│') + ' ' + chalk.white(line) + ' ' + chalk.cyan('│');
            const bBot = chalk.cyan('└') + chalk.cyan('─'.repeat(line.length + 2)) + chalk.cyan('┘');
            if (i === 0 && showTime) {
                console.log(' '.repeat(padLeft) + bTop + '  ' + timestamp);
            } else {
                console.log(' '.repeat(padLeft) + bTop);
            }
            console.log(' '.repeat(padLeft) + bMid);
            console.log(' '.repeat(padLeft) + bBot);
        }
    } else {
        // Left-aligned green bubble (like LINE's received messages)
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const bTop = chalk.green('┌') + chalk.green('─'.repeat(line.length + 2)) + chalk.green('┐');
            const bMid = chalk.green('│') + ' ' + chalk.white(line) + ' ' + chalk.green('│');
            const bBot = chalk.green('└') + chalk.green('─'.repeat(line.length + 2)) + chalk.green('┘');
            if (i === 0 && showTime) {
                console.log('  ' + timestamp);
            }
            console.log('  ' + bTop);
            console.log('  ' + bMid);
            console.log('  ' + bBot);
        }
    }
}

/**
 * Clear the chat area below the header and redraw all messages.
 */
function redrawChat(messages, headerLines) {
    cursorTo(process.stdout, 0, headerLines);
    clearScreenDown(process.stdout);

    for (const msg of messages) {
        renderChatBubble(msg.isOwn, msg.content, msg.timestamp, msg.showTime);
    }
    // Show input prompt
    process.stdout.write(chalk.cyan('  > '));
}

// ============================================================================
// Command: chat (interactive real-time DM mode, with bubble TUI)
// ============================================================================
async function cmdChat(args) {
    const config = getActiveConfig();
    if (!config.token || !config.secretKey) {
        console.error(chalk.red('✖ Not logged in. Use "kb login" or "kb register" first.'));
        process.exit(1);
    }

    let targetUsername = args[0];

    // Interactive mode: search user if not provided
    if (!targetUsername) {
        console.log('');
        console.log('  ' + chalk.bold.cyan('💬 チャット相手を検索'));
        console.log('  ' + chalk.dim('リアルタイムDMで会話する相手を検索して選択'));
        console.log('');

        const query = await askQuestion('  ' + chalk.bold('ユーザー検索:') + ' ');
        if (!query || query.length < 2) {
            console.error(chalk.red('✖ 検索クエリは2文字以上必要です。'));
            process.exit(1);
        }

        const spinner = ora('Searching for "' + query + '"...').start();
        try {
            const users = await apiRequest('GET', '/api/users/search/' + encodeURIComponent(query), null, config.token);
            spinner.stop();

            if (users.length === 0) {
                console.log(chalk.dim(''));
                console.log(chalk.dim('  "' + query + '" に一致するユーザーが見つかりませんでした。'));
                return;
            }

            const selected = await selectFromList(
                users,
                (u) => chalk.bold(u.username) + ' ' + chalk.dim(u.displayName ? '— ' + u.displayName : ''),
                'チャットする相手を選択:'
            );

            if (!selected) {
                console.log(chalk.yellow(''));
                console.log(chalk.yellow('  キャンセルしました。'));
                return;
            }

            targetUsername = selected.username;
        } catch (err) {
            spinner.fail(chalk.red('Search failed: ' + err.message));
            process.exit(1);
        }
    }

    // =========================================================================
    // Chat session — bubble TUI
    // =========================================================================
    try {
        // Resolve target user
        const userData = await apiRequest('GET', '/api/users/' + targetUsername, null, config.token);
        const { default: WebSocket } = await import('ws');

        // Clear terminal for chat mode
        console.clear();

        // ── Draw header ──
        const headerLines = [
            '  ' + chalk.bold.cyan('💬') + ' ' + chalk.bold(targetUsername) + chalk.dim(' とのチャット'),
            '  ' + chalk.cyan('─'.repeat(72)),
            '  ' + chalk.dim('/exit または Ctrl+C で終了'),
            '  ' + chalk.cyan('─'.repeat(72)),
        ];
        for (const line of headerLines) {
            console.log(line);
        }
        const HEADER_LINE_COUNT = headerLines.length + 1; // +1 for blank line

        // ── System status area ──
        console.log('  ' + chalk.dim('🔄 接続中...'));
        const SYSTEM_LINES = 1;

        // ── Message history ──
        const chatMessages = [];

        // Connect to WebSocket
        const ws = new WebSocket(WS_URL + '/ws?token=' + config.token);

        ws.on('open', () => {
            // Update status to connected
            cursorTo(process.stdout, 0, HEADER_LINE_COUNT);
            process.stdout.write('  ' + chalk.green('🟢') + ' ' + chalk.dim('接続しました') + '  ');
            clearScreenDown(process.stdout);
            // Show prompt
            process.stdout.write(chalk.cyan('  > '));
        });

        // Handle incoming messages
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                switch (msg.type) {
                    case 'connected':
                        break;

                    case 'dm_received':
                        if (msg.payload.from.username === targetUsername) {
                            chatMessages.push({
                                isOwn: false,
                                content: msg.payload.content,
                                timestamp: msg.payload.timestamp || new Date().toISOString(),
                                showTime: true,
                            });
                            redrawChat(chatMessages, HEADER_LINE_COUNT + SYSTEM_LINES);
                        }
                        break;

                    case 'dm:sent':
                        // Avoid duplicates (we also add on local send)
                        {
                            const last = chatMessages[chatMessages.length - 1];
                            if (!last || last.content !== msg.payload.content || last.isOwn !== true) {
                                chatMessages.push({
                                    isOwn: true,
                                    content: msg.payload.content,
                                    timestamp: msg.payload.timestamp || new Date().toISOString(),
                                    showTime: true,
                                });
                                redrawChat(chatMessages, HEADER_LINE_COUNT + SYSTEM_LINES);
                            }
                        }
                        break;

                    case 'error':
                        redrawChat(chatMessages, HEADER_LINE_COUNT + SYSTEM_LINES);
                        process.stdout.write(chalk.red('  ✖ ' + msg.payload.message + '\\n'));
                        process.stdout.write(chalk.cyan('  > '));
                        break;

                    case 'user_online':
                        if (msg.payload.username === targetUsername) {
                            cursorTo(process.stdout, 0, HEADER_LINE_COUNT);
                            process.stdout.write('  ' + chalk.green('🟢') + ' ' + chalk.dim('オンライン') + '  ');
                            redrawChat(chatMessages, HEADER_LINE_COUNT + SYSTEM_LINES);
                        }
                        break;

                    case 'user_offline':
                        if (msg.payload.userId === userData.id) {
                            cursorTo(process.stdout, 0, HEADER_LINE_COUNT);
                            process.stdout.write('  ' + chalk.red('🔴') + ' ' + chalk.dim('オフライン') + '  ');
                            redrawChat(chatMessages, HEADER_LINE_COUNT + SYSTEM_LINES);
                        }
                        break;

                    default:
                        break;
                }
            } catch {
                // Ignore parse errors
            }
        });

        ws.on('close', () => {
            console.log();
            console.log('  ' + chalk.yellow('⚠️ 切断されました。'));
            process.exit(0);
        });

        ws.on('error', (err) => {
            console.log();
            console.log('  ' + chalk.red('✖ WebSocket error: ' + err.message));
            process.exit(1);
        });

        // ── Handle user input ──
        let inputBuffer = '';

        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', async (chunk) => {
            inputBuffer += chunk;

            if (inputBuffer.includes('\\n')) {
                const lines = inputBuffer.split('\\n');
                inputBuffer = lines.pop(); // Keep incomplete line

                for (const line of lines) {
                    const trimmed = line.trim();

                    if (!trimmed) {
                        process.stdout.write(chalk.cyan('  > '));
                        continue;
                    }

                    if (trimmed === '/exit') {
                        console.log(chalk.dim('  Closing connection...'));
                        ws.close();
                        return;
                    }

                    // Sign and send the message
                    try {
                        const { signMessage } = await import('../src/auth/ed25519.js');
                        const signature = await signMessage(trimmed, config.secretKey);

                        ws.send(JSON.stringify({
                            type: 'dm:send',
                            payload: {
                                recipientId: userData.id,
                                content: trimmed,
                                signature,
                            },
                        }));

                        // Add to local message history immediately (optimistic update)
                        chatMessages.push({
                            isOwn: true,
                            content: trimmed,
                            timestamp: new Date().toISOString(),
                            showTime: true,
                        });
                        redrawChat(chatMessages, HEADER_LINE_COUNT + SYSTEM_LINES);
                    } catch (err) {
                        redrawChat(chatMessages, HEADER_LINE_COUNT + SYSTEM_LINES);
                        process.stdout.write('  ' + chalk.red('✖ ' + err.message) + '\\n');
                        process.stdout.write(chalk.cyan('  > '));
                    }
                }
            }
        });

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log();
            console.log(chalk.dim('  Closing...'));
            ws.close();
            process.exit(0);
        });

    } catch (err) {
        console.error(chalk.red('Failed to start chat: ' + err.message));
        process.exit(1);
    }
}

async function cmdRealtime() {
    const config = getActiveConfig();
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

    // Auto-initialize local mode if --local flag is present
    if (IS_LOCAL) {
        await autoInitLocalMode();
    }

    // No args — show help with active account context
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

        case 'accounts':
        case 'account':
            // 'account remove <username>' or 'accounts' (list)
            if (command === 'account') {
                await cmdAccount(args.slice(1));
            } else {
                await cmdAccounts();
            }
            break;

        case 'switch':
            await cmdSwitch(args.slice(1));
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

        case 'edit-profile':
            await cmdEditProfile(args.slice(1));
            break;

        case 'chat':
            await cmdChat(args.slice(1));
            break;

        case 'admin':
            await cmdAdmin(args.slice(1));
            break;

        case 'nostr':
            await cmdNostr(args.slice(1));
            break;
        case 'server':
            await cmdServer(args.slice(1));
            break;
        case 'connect':
            await cmdConnect(args.slice(1));
            break;

        case 'p2p':
            await cmdP2P(args.slice(1));
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
