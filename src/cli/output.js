// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// CLI Output Utilities
// License: MIT
// ============================================================================
// Provides unified output handling for both human-readable and machine-readable (--json) modes.
// ============================================================================

import chalk from 'chalk';

/**
 * Global output mode state
 */
let outputMode = {
    json: false,
    quiet: false,
    noColor: false
};

/**
 * Set output mode from parsed global flags
 */
export function setOutputMode({ json, quiet, noColor }) {
    outputMode.json = json;
    outputMode.quiet = quiet;
    outputMode.noColor = noColor;
}

/**
 * Check if JSON output mode is enabled
 */
export function isJsonMode() {
    return outputMode.json;
}

/**
 * Print machine-readable JSON to stdout
 * In --json mode, ALL output goes to stdout as JSON
 */
export function printJson(data) {
    if (outputMode.json) {
        console.log(JSON.stringify(data, null, 2));
    }
}

/**
 * Print error in JSON mode (to stdout) or human mode (to stderr)
 */
export function printError(err, context = '') {
    const message = err instanceof Error ? err.message : String(err);
    
    if (outputMode.json) {
        console.log(JSON.stringify({
            ok: false,
            error: {
                message,
                context,
                code: err.code || 'ERROR'
            }
        }, null, 2));
    } else {
        const prefix = outputMode.noColor ? '' : chalk.red('✖ ');
        const msg = context ? `${context}: ${message}` : message;
        console.error(`${prefix}${msg}`);
    }
}

/**
 * Print success message
 */
export function ok(data, message = '') {
    if (outputMode.json) {
        console.log(JSON.stringify({ ok: true, data, message }, null, 2));
    } else if (!outputMode.quiet) {
        const prefix = outputMode.noColor ? '' : chalk.green('✔ ');
        console.log(`${prefix}${message}`);
        if (data && typeof data === 'object') {
            console.log(JSON.stringify(data, null, 2));
        }
    }
}

/**
 * Print failure and exit
 */
export function fail(code, message, context = '') {
    const err = new Error(message);
    err.code = code;
    printError(err, context);
    process.exit(code);
}

/**
 * Print info message (only in human mode, non-quiet)
 */
export function info(message) {
    if (!outputMode.json && !outputMode.quiet) {
        const prefix = outputMode.noColor ? '' : chalk.cyan('ℹ ');
        console.log(`${prefix}${message}`);
    }
}

/**
 * Print warning message (only in human mode)
 */
export function warn(message) {
    if (!outputMode.json) {
        const prefix = outputMode.noColor ? '' : chalk.yellow('⚠ ');
        console.error(`${prefix}${message}`);
    }
}

/**
 * Format data for human-readable output
 */
export function formatHuman(data, options = {}) {
    if (outputMode.json) return null;
    if (typeof data === 'string') return data;
    return JSON.stringify(data, null, options.indent || 2);
}