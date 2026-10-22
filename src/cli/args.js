// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// CLI Argument Parser (util.parseArgs wrapper)
// License: MIT
// ============================================================================
// Provides a consistent argument parsing layer for all kb commands.
// Supports global flags: --json, --quiet, --no-color, --yes, --interactive,
// --local, --help, --version
// ============================================================================

import { parseArgs } from 'node:util';
import { ExitCode, exit } from './exit.js';

/**
 * Global flags that apply to all commands.
 */
export const GLOBAL_FLAGS = {
    /** Machine-readable JSON output */
    json: { type: 'boolean', short: 'j', default: false },
    /** Minimal output (errors only) */
    quiet: { type: 'boolean', short: 'q', default: false },
    /** Disable ANSI color codes */
    'no-color': { type: 'boolean', default: false },
    /** Auto-confirm prompts (assume 'yes') */
    yes: { type: 'boolean', short: 'y', default: false },
    /** Enable interactive prompts (default: disabled for automation) */
    interactive: { type: 'boolean', short: 'i', default: false },
    /** Force serverless/local mode */
    local: { type: 'boolean', default: false },
    /** Show help */
    help: { type: 'boolean', short: 'h', default: false },
    /** Show version */
    version: { type: 'boolean', short: 'v', default: false },
};

/**
 * Parse command line arguments with global flags.
 *
 * @param {string[]} args - process.argv.slice(2)
 * @param {Object} commandFlags - Command-specific flags definition
 * @returns {Object} Parsed result with `values` (flags), `positionals` (non-flag args), and `global` (global flags)
 */
export function parseCommandArgs(args, commandFlags = {}) {
    // Combine global and command-specific flags
    const allFlags = {
        ...GLOBAL_FLAGS,
        ...commandFlags,
    };

    // parseArgs with allowPositionals: true to capture non-flag arguments
    const { values, positionals } = parseArgs({
        args,
        options: allFlags,
        strict: false,          // Allow unknown flags (pass through to command)
        allowPositionals: true, // Capture positional arguments
    });

    // Extract global flags
    const global = {};
    for (const key of Object.keys(GLOBAL_FLAGS)) {
        const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        global[camelKey] = values[key];
    }

    // Handle --help / --version early
    if (global.help) {
        return { values, positionals, global, showHelp: true };
    }
    if (global.version) {
        return { values, positionals, global, showVersion: true };
    }

    // Remove global flags from values so command-specific parser doesn't see them
    const commandValues = { ...values };
    for (const key of Object.keys(GLOBAL_FLAGS)) {
        delete commandValues[key];
    }

    return { values: commandValues, positionals, global };
}

/**
 * Parse arguments for a specific command with its own flag definitions.
 * Returns parsed values and positionals.
 *
 * @param {string[]} args
 * @param {Object} flagDefs - Flag definitions for this command
 * @returns {Object} { values, positionals }
 */
export function parseCommandSpecificArgs(args, flagDefs) {
    const { values, positionals } = parseArgs({
        args,
        options: flagDefs,
        strict: false,
        allowPositionals: true,
    });
    return { values, positionals };
}

/**
 * Validate that required positional arguments are present.
 * Exits with USAGE (2) if missing.
 *
 * @param {string[]} positionals
 * @param {number} minRequired
 * @param {string} usage - Usage string for error message
 */
export function requirePositionals(positionals, minRequired, usage) {
    if (positionals.length < minRequired) {
        console.error(`Usage: ${usage}`);
        console.error(`Error: Expected at least ${minRequired} positional argument(s), got ${positionals.length}`);
        exit(ExitCode.USAGE);
    }
}

/**
 * Handle --help flag by showing usage and exiting.
 *
 * @param {Object} global - Global flags from parseCommandArgs
 * @param {string} usage - Full usage string
 * @param {string} description - Command description
 * @param {Object} [flags] - Command-specific flags for help display
 */
export function handleHelp(global, usage, description, flags = {}) {
    if (!global.help) return;

    console.log(`${description}\n`);
    console.log(`Usage: ${usage}\n`);

    if (Object.keys(GLOBAL_FLAGS).length > 0) {
        console.log('Global options:');
        for (const [key, def] of Object.entries(GLOBAL_FLAGS)) {
            const short = def.short ? `, -${def.short}` : '';
            console.log(`  --${key}${short}    ${getFlagDescription(key)}`);
        }
        console.log();
    }

    if (Object.keys(flags).length > 0) {
        console.log('Command options:');
        for (const [key, def] of Object.entries(flags)) {
            const short = def.short ? `, -${def.short}` : '';
            const type = def.type === 'boolean' ? '' : ` <${def.type}>`;
            console.log(`  --${key}${short}${type}`);
        }
        console.log();
    }

    exit(ExitCode.OK);
}

function getFlagDescription(key) {
    const descriptions = {
        json: 'Output machine-readable JSON',
        quiet: 'Minimal output (errors only)',
        'no-color': 'Disable ANSI color codes',
        yes: 'Auto-confirm prompts',
        interactive: 'Enable interactive prompts',
        local: 'Force serverless/local mode',
        help: 'Show this help',
        version: 'Show version',
    };
    return descriptions[key] || '';
}

/**
 * Merge config with CLI args (CLI args take precedence).
 *
 * @param {Object} config - Config object from config file
 * @param {Object} cliArgs - Parsed CLI args
 * @returns {Object} Merged config
 */
export function mergeConfig(config, cliArgs) {
    return {
        ...config,
        ...cliArgs,
        // Explicitly handle boolean flags where CLI false should not override config true
        ...Object.fromEntries(
            Object.entries(cliArgs).filter(([, v]) => v !== undefined)
        ),
    };
}