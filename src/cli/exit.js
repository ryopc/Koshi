// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Exit Code Conventions
// License: MIT
// ============================================================================
// Standardized exit codes for CLI commands. Used by src/cli/args.js and
// all command handlers to ensure machine-readable exit semantics.
// ============================================================================

/**
 * Exit codes following common conventions (sysexits.h + custom).
 */
export const ExitCode = {
    /** 成功 */
    OK: 0,

    /** 一般的なエラー（分類不能） */
    ERROR: 1,

    /** 引数・使用法エラー（--help 表示含む） */
    USAGE: 2,

    /** 認証・認可エラー（トークン不備、スコープ不足、API キー無効等） */
    AUTH: 3,

    /** ネットワーク・接続エラー（DNS、タイムアウト、接続拒否等） */
    NETWORK: 4,

    /** 競合（既に存在、ユニーク制約違反等） */
    CONFLICT: 5,

    /** レート制限超過 */
    RATE_LIMITED: 6,

    /** 未実装・未サポート */
    UNIMPLEMENTED: 7,

    /** 設定エラー（設定ファイル不備、環境変数欠落等） */
    CONFIG: 8,

    /** データベースエラー */
    DATABASE: 9,

    /** 検証エラー（入力値不正、署名検証失敗等） */
    VALIDATION: 10,

    /** 権限不足（管理者専用コマンド等） */
    PERMISSION: 11,

    /** 中断 (SIGINT / SIGTERM) */
    INTERRUPTED: 130,
};

/**
 * Human-readable description for each exit code.
 */
export const ExitCodeDescription = {
    [ExitCode.OK]: 'Success',
    [ExitCode.ERROR]: 'General error',
    [ExitCode.USAGE]: 'Usage / argument error',
    [ExitCode.AUTH]: 'Authentication / authorization error',
    [ExitCode.NETWORK]: 'Network / connection error',
    [ExitCode.CONFLICT]: 'Conflict (already exists)',
    [ExitCode.RATE_LIMITED]: 'Rate limited',
    [ExitCode.UNIMPLEMENTED]: 'Not implemented',
    [ExitCode.CONFIG]: 'Configuration error',
    [ExitCode.DATABASE]: 'Database error',
    [ExitCode.VALIDATION]: 'Validation error',
    [ExitCode.PERMISSION]: 'Permission denied',
    [ExitCode.INTERRUPTED]: 'Interrupted (SIGINT/SIGTERM)',
};

/**
 * Map common error patterns to exit codes.
 * Used by the global error handler in bin/cli.js
 */
export function mapErrorToExitCode(err) {
    if (!err) return ExitCode.ERROR;

    const message = err instanceof Error ? err.message : String(err);

    // Network errors
    if (
        message.includes('ECONNREFUSED') ||
        message.includes('ENOTFOUND') ||
        message.includes('ETIMEDOUT') ||
        message.includes('socket hang up') ||
        message.includes('fetch failed')
    ) {
        return ExitCode.NETWORK;
    }

    // Auth errors
    if (
        message.includes('Authentication required') ||
        message.includes('Invalid token') ||
        message.includes('Token expired') ||
        message.includes('Invalid API key') ||
        message.includes('API key revoked') ||
        message.includes('API key expired') ||
        message.includes('Insufficient scope')
    ) {
        return ExitCode.AUTH;
    }

    // Permission errors
    if (
        message.includes('Forbidden') ||
        message.includes('Admin privileges required') ||
        message.includes('Permission denied')
    ) {
        return ExitCode.PERMISSION;
    }

    // Conflict errors
    if (
        message.includes('already registered') ||
        message.includes('already exists') ||
        message.includes('unique constraint') ||
        message.includes('duplicate key')
    ) {
        return ExitCode.CONFLICT;
    }

    // Rate limit
    if (
        message.includes('rate limit') ||
        message.includes('too many requests') ||
        message.includes('429')
    ) {
        return ExitCode.RATE_LIMITED;
    }

    // Validation
    if (
        message.includes('Invalid') ||
        message.includes('validation') ||
        message.includes('must be') ||
        message.includes('required') ||
        message.includes('signature verification failed') ||
        message.includes('Bad Request')
    ) {
        return ExitCode.VALIDATION;
    }

    // Database
    if (
        message.includes('DATABASE_URL') ||
        message.includes('connection') ||
        message.includes('pool') ||
        message.includes('sqlite') ||
        message.includes('better-sqlite3')
    ) {
        return ExitCode.DATABASE;
    }

    // Config
    if (
        message.includes('config') ||
        message.includes('CONFIG_FILE') ||
        message.includes('serverUrl') ||
        message.includes('KOSHI_API_URL')
    ) {
        return ExitCode.CONFIG;
    }

    return ExitCode.ERROR;
}

/**
 * Exit the process with the given code.
 * Logs a standardized message if not OK.
 *
 * @param {number} code
 * @param {string} [message] - Optional additional context
 */
export function exit(code, message) {
    if (code !== ExitCode.OK && message) {
        // Use console.error for stderr (machine-readable output uses stdout)
        console.error(`[exit ${code}] ${ExitCodeDescription[code]}${message ? `: ${message}` : ''}`);
    }
    process.exit(code);
}

/**
 * Wrap an async function to catch errors and exit with appropriate code.
 * Usage: `await withExit(async () => { await doSomething(); })`
 */
export function withExit(fn) {
    return fn().catch((err) => {
        exit(mapErrorToExitCode(err), err instanceof Error ? err.message : String(err));
        // Never reaches here due to process.exit, but TS needs a return
        throw err;
    });
}

/**
 * Handle SIGINT / SIGTERM gracefully.
 * Call once at startup.
 */
export function setupSignalHandlers() {
    const handleSignal = (signal) => {
        console.error(`\n[signal] Received ${signal}, exiting...`);
        exit(ExitCode.INTERRUPTED);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
}