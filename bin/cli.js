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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { cursorTo, clearScreenDown } from 'node:readline';
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
// Config format:
// {
//   "activeUsername": "user1",           // currently active account
//   "accounts": {
//     "user1": {
//       "userId": "uuid",
//       "username": "user1",
//       "publicKey": "hex",
//       "secretKey": "hex",
//       "token": "jwt"
//     },
//     "user2": { ... }
//   }
// }
// ============================================================================

/**
 * Load the full config file (multi-account format).
 * Automatically migrates from legacy single-account format.
 */
function loadFullConfig() {
    try {
        if (existsSync(CONFIG_FILE)) {
            const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));

            // Already in new format with accounts map
            if (data.accounts && typeof data.accounts === 'object') {
                return data;
            }

            // Legacy format: single account at root level
            // data = { userId, username, publicKey, secretKey, token, ... }
            if (data.username && data.secretKey) {
                const migrated = {
                    activeUsername: data.username,
                    accounts: {
                        [data.username]: {
                            userId: data.userId,
                            username: data.username,
                            publicKey: data.publicKey,
                            secretKey: data.secretKey,
                            token: data.token,
                        },
                    },
                };
                // Save migrated config immediately
                try {
                    writeFileSync(CONFIG_FILE, JSON.stringify(migrated, null, 2), 'utf-8');
                } catch {
                    // Best effort
                }
                return migrated;
            }
        }

        // Fallback to legacy .snsrc
        if (existsSync(SNSRC_FILE)) {
            const snsrcData = readFileSync(SNSRC_FILE, 'utf-8').trim();
            if (snsrcData) {
                try {
                    const parsed = JSON.parse(snsrcData);
                    if (parsed.secretKey && parsed.username) {
                        const migrated = {
                            activeUsername: parsed.username,
                            accounts: {
                                [parsed.username]: {
                                    username: parsed.username,
                                    secretKey: parsed.secretKey,
                                },
                            },
                        };
                        return migrated;
                    }
                } catch {
                    // Plain text format
                    const lines = snsrcData.split('\n');
                    if (lines.length >= 2) {
                        const u = lines[1].trim();
                        const migrated = {
                            activeUsername: u,
                            accounts: {
                                [u]: {
                                    username: u,
                                    secretKey: lines[0].trim(),
                                },
                            },
                        };
                        return migrated;
                    }
                }
            }
        }
    } catch {
        // Config file doesn't exist or is corrupt
    }
    // Default: empty config
    return { activeUsername: null, accounts: {} };
}

/**
 * Save the full multi-account config.
 */
async function saveFullConfig(config) {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

    // Update legacy .snsrc with active account's secret key
    const active = config.activeUsername ? config.accounts[config.activeUsername] : null;
    if (active && active.secretKey) {
        writeFileSync(SNSRC_FILE, `${active.secretKey}\n${active.username}\n`, 'utf-8');
    }

    // Set restrictive permissions
    try {
        const { chmod } = await import('node:fs/promises');
        await chmod(CONFIG_FILE, 0o600);
        await chmod(SNSRC_FILE, 0o600);
    } catch {
        // chmod not critical
    }
}

/**
 * Get the currently active account's config (backward-compatible).
 * Returns {} if not logged in / no active account.
 */
function getActiveConfig() {
    const full = loadFullConfig();
    if (full.activeUsername && full.accounts[full.activeUsername]) {
        return full.accounts[full.activeUsername];
    }
    return {};
}

/**
 * List all stored account usernames.
 */
function listAccountNames() {
    const full = loadFullConfig();
    return Object.keys(full.accounts);
}

/**
 * Get the full config and active config together.
 */
function getConfigBundle() {
    const full = loadFullConfig();
    const active = full.activeUsername && full.accounts[full.activeUsername]
        ? full.accounts[full.activeUsername]
        : {};
    return { full, active, activeUsername: full.activeUsername };
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

        spinner.text = 'Registering with server...';

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

        spinner.text = 'Authenticating with server...';

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
    console.log(`  ${chalk.dim('Version 1.3.0 — 複数アカウント対応')}`);
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
    console.log('koshi v1.3.0');
    console.log('Terminal-native decentralized SNS — 複数アカウント対応');
    console.log('License: MIT');
    console.log('Author: game_ryo');
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
