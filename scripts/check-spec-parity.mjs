#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Spec Parity Checker
// License: MIT
// ============================================================================
// Compares OpenAPI paths with actual Express routes in src/api/*.js
// Exits with code 0 if parity, 1 if drift detected
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(__dirname, '..', 'src', 'spec', 'openapi.yaml');
const API_DIR = join(__dirname, '..', 'src', 'api');
const LOCAL_API_DIR = join(__dirname, '..', 'src', 'local');

// Known routes that are intentionally not in OpenAPI (e.g., internal, deprecated)
const ALLOWLIST_PATH = join(__dirname, 'route-parity.allowlist.json');
let ALLOWLIST = [];
try {
    ALLOWLIST = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'));
} catch {
    // No allowlist file, that's fine
}

function parseOpenAPIPaths() {
    const yaml = readFileSync(SPEC_PATH, 'utf-8');
    const paths = [];
    const lines = yaml.split('\n');
    let inPaths = false;

    for (const line of lines) {
        if (line.trim() === 'paths:') {
            inPaths = true;
            continue;
        }
        if (inPaths && line.match(/^  \/[a-z]/)) {
            // Path line: "  /path:"
            const match = line.match(/^  (\/.+):$/);
            if (match) {
                paths.push(match[1]);
            }
        }
        if (inPaths && line.match(/^[a-z]/) && !line.startsWith('  ')) {
            // Left top-level section
            break;
        }
    }
    return new Set(paths);
}

function extractRoutesFromFile(filePath, basePath = '') {
    const routes = new Set();
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
        // Match router.METHOD('path', ...) patterns
        const match = line.match(/router\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/);
        if (match) {
            let path = match[2];
            // Normalize path parameters
            path = path.replace(/:(\w+)/g, '{$1}');
            // Prepend base path
            if (basePath) {
                path = basePath + path;
            }
            routes.add(path);
        }
    }
    return routes;
}

function parseRouteFiles() {
    const routes = new Set();

    // 1. Main API routes (mounted at /api)
    const apiFiles = readdirSync(API_DIR).filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'discovery.js');
    for (const file of apiFiles) {
        const fileRoutes = extractRoutesFromFile(join(API_DIR, file), '/api');
        for (const r of fileRoutes) routes.add(r);
    }

    // 2. Discovery routes (mounted at root)
    const discoveryRoutes = extractRoutesFromFile(join(API_DIR, 'discovery.js'), '');
    for (const r of discoveryRoutes) routes.add(r);

    // 3. Local API routes (for serverless mode parity check)
    try {
        const localContent = readFileSync(join(LOCAL_API_DIR, 'server-standalone.js'), 'utf-8');
        const localLines = localContent.split('\n');
        for (const line of localLines) {
            const match = line.match(/app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/);
            if (match) {
                let path = match[2].replace(/:(\w+)/g, '{$1}');
                routes.add(path);
            }
        }
    } catch {
        // Local server file might not exist
    }

    return routes;
}

function main() {
    console.log('🔍 Checking OpenAPI spec parity...\n');

    const openApiPaths = parseOpenAPIPaths();
    const routePaths = parseRouteFiles();

    console.log(`OpenAPI paths: ${openApiPaths.size}`);
    console.log(`Route paths:   ${routePaths.size}\n`);

    // Check for routes not in OpenAPI
    const missingInSpec = [];
    for (const route of routePaths) {
        if (!openApiPaths.has(route) && !ALLOWLIST.missingInSpec?.includes(route)) {
            missingInSpec.push(route);
        }
    }

    // Check for OpenAPI paths not implemented
    const missingInRoutes = [];
    for (const specPath of openApiPaths) {
        if (!routePaths.has(specPath) && !ALLOWLIST.missingInRoutes?.includes(specPath)) {
            missingInRoutes.push(specPath);
        }
    }

    let hasErrors = false;

    if (missingInSpec.length > 0) {
        console.log('❌ Routes MISSING from OpenAPI spec:');
        for (const r of missingInSpec.sort()) {
            console.log(`   ${r}`);
        }
        console.log();
        hasErrors = true;
    }

    if (missingInRoutes.length > 0) {
        console.log('❌ OpenAPI paths NOT IMPLEMENTED in routes:');
        for (const r of missingInRoutes.sort()) {
            console.log(`   ${r}`);
        }
        console.log();
        hasErrors = true;
    }

    if (!hasErrors) {
        console.log('✅ Perfect parity! All routes documented and all spec paths implemented.');
        return 0;
    } else {
        console.log(`\n📝 To allowlist intentional differences, edit: ${ALLOWLIST_PATH}`);
        return 1;
    }
}

const exitCode = main();
process.exit(exitCode);