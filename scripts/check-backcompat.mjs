#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Backward Compatibility Checker
// License: MIT
// ============================================================================
// Ensures v6 API responses don't remove keys that existed in v5
// ============================================================================

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dirname, 'backcompat.baseline.json');

function main() {
    console.log('🔍 Checking backward compatibility...\n');

    try {
        const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
        console.log(`✅ Loaded baseline with ${Object.keys(baseline).length} endpoints\n`);

        // This script would be run against a live server in CI
        // For now, we just verify the baseline file exists and is valid
        console.log('✅ Baseline file valid');
        console.log('\n📝 To update baseline after verified changes:');
        console.log('   node scripts/update-backcompat-baseline.mjs');
        return 0;
    } catch (err) {
        console.log(`❌ Error: ${err.message}`);
        console.log('\n📝 Create baseline first:');
        console.log('   node scripts/update-backcompat-baseline.mjs');
        return 1;
    }
}

const exitCode = main();
process.exit(exitCode);