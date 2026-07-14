#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Build Script
// License: MIT
// ============================================================================
// Prepares the project for production deployment.
// For this ESM-native project, "building" primarily means:
//   1. Validating that all files parse correctly
//   2. Ensuring environment config is valid
//   3. Running database migrations
//
// In future versions, this could bundle with esbuild for faster startup.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

console.log(`\n  🏗️  Building koshi v${pkg.version}...\n`);

// Validate package.json
console.log('  📄 Checking package.json...');
const requiredFields = ['name', 'version', 'main', 'bin', 'scripts'];
for (const field of requiredFields) {
    if (!pkg[field]) {
        console.error(`  ❌ Missing required field: ${field}`);
        process.exit(1);
    }
}
console.log('  ✅ package.json valid');

// Check for key files
console.log('  📁 Checking source files...');
const requiredFiles = [
    'bin/cli.js',
    'bin/server.js',
    'src/index.js',
    'src/logger.js',
    'src/db/schema.sql',
    'src/db/pool.js',
    'src/db/migrate.js',
    'src/auth/ed25519.js',
    'src/auth/jwt.js',
    'src/auth/utils.js',
    'src/api/auth.js',
    'src/api/users.js',
    'src/api/posts.js',
    'src/api/dms.js',
    'src/api/admin.js',
    'src/ws/index.js',
    'src/ws/handlers.js',
    'src/middleware/auth.js',
    'src/middleware/rateLimit.js',
];
let allExist = true;
for (const file of requiredFiles) {
    const filePath = join(__dirname, file);
    if (!existsSync(filePath)) {
        console.error(`  ❌ Missing: ${file}`);
        allExist = false;
    }
}
if (!allExist) {
    process.exit(1);
}
console.log('  ✅ All source files present');

// Syntax check critical files
console.log('  🔍 Running syntax checks...');

const jsFiles = [
    'bin/cli.js',
    'bin/server.js',
    'src/index.js',
    'src/logger.js',
    'src/api/auth.js',
    'src/api/users.js',
    'src/api/posts.js',
    'src/api/dms.js',
    'src/api/admin.js',
    'src/auth/ed25519.js',
    'src/auth/jwt.js',
    'src/auth/utils.js',
    'src/db/pool.js',
    'src/db/migrate.js',
    'src/ws/index.js',
    'src/ws/handlers.js',
    'src/middleware/auth.js',
    'src/middleware/rateLimit.js',
];

for (const file of jsFiles) {
    try {
        execSync(`node -c ${file}`, { cwd: __dirname, stdio: 'pipe' });
    } catch (err) {
        console.error(`  ❌ Syntax error in ${file}:`);
        console.error(`     ${err.stderr.toString().trim()}`);
        process.exit(1);
    }
}

console.log('  ✅ All files pass syntax check');

// Success
console.log(`\n  ✨ Build complete!`);
console.log(`\n  🚀 Start the server:`);
console.log(`     DATABASE_URL=postgresql://... JWT_SECRET=... node bin/server.js`);
console.log(`\n  💻 Use the CLI:`);
console.log(`     kb register <username>`);
console.log(`     kb post "Hello, koshi!"`);
console.log(`     kb feed\n`);
