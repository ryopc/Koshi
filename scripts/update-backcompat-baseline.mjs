#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Backward Compatibility Baseline Updater
// License: MIT
// ============================================================================
// Fetches current API responses and updates the baseline
// Run against a running server: BASE_URL=http://localhost:3000 node scripts/update-backcompat-baseline.mjs
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(__dirname, 'backcompat.baseline.json');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Endpoints to test (method, path, auth required)
const ENDPOINTS = [
    { method: 'GET', path: '/api/health', auth: false },
    { method: 'POST', path: '/api/auth/register', auth: false, body: { username: 'test_baseline', publicKey: 'a'.repeat(64) }, expectFail: true },
    { method: 'POST', path: '/api/auth/login', auth: false, body: { username: 'test', signature: 'b'.repeat(128) }, expectFail: true },
    { method: 'GET', path: '/api/users/search/test', auth: false },
    { method: 'GET', path: '/api/users/me', auth: true },
    { method: 'GET', path: '/api/users/testuser', auth: false },
    { method: 'GET', path: '/api/posts/feed', auth: false },
    { method: 'GET', path: '/api/dms', auth: true },
    { method: 'GET', path: '/api/dms/unread/count', auth: true },
    { method: 'GET', path: '/api/groups', auth: true },
    { method: 'GET', path: '/api/devices', auth: true },
    { method: 'GET', path: '/api/keys/bundle/test', auth: true },
    { method: 'GET', path: '/api/admin/users', auth: true }
];

async function fetchEndpoint(ep, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (ep.auth && token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const res = await fetch(`${BASE_URL}${ep.path}`, {
            method: ep.method,
            headers,
            body: ep.body ? JSON.stringify(ep.body) : undefined
        });

        const text = await res.text();
        let json = {};
        try { json = JSON.parse(text); } catch {}

        return { status: res.status, keys: Object.keys(json), json };
    } catch (err) {
        return { error: err.message };
    }
}

async function main() {
    console.log(`🔄 Updating backcompat baseline from ${BASE_URL}...\n`);

    // We need a token for authenticated endpoints
    // For now, just document the expected keys
    // In real CI, this would use a test account

    const baseline = {};
    for (const ep of ENDPOINTS) {
        const result = await fetchEndpoint(ep, null);
        if (result.error) {
            console.log(`⚠️  ${ep.method} ${ep.path}: ${result.error}`);
            continue;
        }

        const normPath = ep.path.replace(/\/[0-9a-f-]{36}/g, '/{id}').replace(/\/[a-zA-Z0-9_-]+/g, '/{username}');
        baseline[normPath] = {
            method: ep.method,
            requiredKeys: result.keys,
            status: result.status
        };
        console.log(`✅ ${ep.method} ${normPath}: ${result.keys.length} keys (status ${result.status})`);
    }

    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
    console.log(`\n✅ Baseline updated: ${BASELINE_PATH}`);
}

main().catch(err => {
    console.error('❌', err);
    process.exit(1);
});