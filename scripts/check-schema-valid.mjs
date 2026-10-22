#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// JSON Schema Validator
// License: MIT
// ============================================================================
// Validates all JSON Schema files in src/spec/ for syntactic correctness
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(__dirname, '..', 'src', 'spec');

function validateSchema(filePath) {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const schema = JSON.parse(content);

        // Basic schema validation - check for required fields
        if (!schema.$schema) {
            return { valid: false, error: 'Missing $schema' };
        }
        if (!schema.$id) {
            return { valid: false, error: 'Missing $id' };
        }
        if (schema.type !== 'object' && !schema.allOf && !schema.definitions) {
            return { valid: false, error: 'Root must be object, allOf, or definitions' };
        }

        return { valid: true };
    } catch (err) {
        return { valid: false, error: err.message };
    }
}

function main() {
    console.log('🔍 Validating JSON Schemas...\n');

    const files = readdirSync(SPEC_DIR).filter(f => f.endsWith('.schema.json'));
    let hasErrors = false;

    for (const file of files) {
        const filePath = join(SPEC_DIR, file);
        const result = validateSchema(filePath);

        if (result.valid) {
            console.log(`✅ ${file}`);
        } else {
            console.log(`❌ ${file}: ${result.error}`);
            hasErrors = true;
        }
    }

    console.log();
    if (hasErrors) {
        console.log('❌ Schema validation failed');
        return 1;
    } else {
        console.log('✅ All schemas valid');
        return 0;
    }
}

const exitCode = main();
process.exit(exitCode);