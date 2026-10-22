#!/usr/bin/env node
// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// A2A Agent Card Validator
// License: MIT
// ============================================================================
// Validates that generated Agent Cards conform to A2A schema
// ============================================================================

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'src', 'spec', 'agent-card.schema.json');

function validateAgentCard(card, schema) {
    const errors = [];

    // Required fields
    const required = ['name', 'description', 'url', 'capabilities'];
    for (const field of required) {
        if (!card[field]) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    // Type checks
    if (card.name && typeof card.name !== 'string') {
        errors.push('name must be string');
    }
    if (card.description && typeof card.description !== 'string') {
        errors.push('description must be string');
    }
    if (card.url && typeof card.url !== 'string') {
        errors.push('url must be string');
    }
    if (card.capabilities && !Array.isArray(card.capabilities)) {
        errors.push('capabilities must be array');
    } else if (Array.isArray(card.capabilities)) {
        for (let i = 0; i < card.capabilities.length; i++) {
            const cap = card.capabilities[i];
            if (typeof cap !== 'object' || !cap.name) {
                errors.push(`capabilities[${i}] must have name`);
            }
        }
    }

    // Skills validation
    if (card.skills && !Array.isArray(card.skills)) {
        errors.push('skills must be array');
    } else if (Array.isArray(card.skills)) {
        for (let i = 0; i < card.skills.length; i++) {
            const skill = card.skills[i];
            if (!skill.name || !skill.description) {
                errors.push(`skills[${i}] must have name and description`);
            }
        }
    }

    // Metadata validation (Koshi extensions)
    if (card.metadata && typeof card.metadata !== 'object') {
        errors.push('metadata must be object');
    } else if (card.metadata?.koshi) {
        const koshi = card.metadata.koshi;
        if (koshi.agentKind && !['llm', 'bot', 'automation', 'service'].includes(koshi.agentKind)) {
            errors.push('metadata.koshi.agentKind must be one of: llm, bot, automation, service');
        }
        const validCaps = ['posts:read', 'posts:write', 'dms:read', 'dms:write', 'groups:read', 'groups:write', 'users:read', 'events:read', 'events:write', 'admin:read'];
        if (koshi.agentCapabilities && Array.isArray(koshi.agentCapabilities)) {
            for (const cap of koshi.agentCapabilities) {
                if (!validCaps.includes(cap)) {
                    errors.push(`Invalid capability in metadata: ${cap}`);
                }
            }
        }
    }

    return errors;
}

function main() {
    console.log('🔍 Validating A2A Agent Card schema...\n');

    try {
        const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
        console.log('✅ Schema file loaded\n');

        // Test with a sample card
        const sampleCard = {
            name: 'Test Agent',
            description: 'A test agent for Koshi',
            url: 'https://koshi.ryopc.org/agent/test',
            provider: { name: 'koshi', url: 'https://koshi.ryopc.org' },
            version: '1.0.0',
            capabilities: [
                { name: 'posts:read', description: 'Read posts' },
                { name: 'posts:write', description: 'Write posts' }
            ],
            skills: [
                { name: 'posts:read', description: 'Can read posts from feed', tags: ['posts'], examples: ['Get latest posts'] },
                { name: 'posts:write', description: 'Can create posts', tags: ['posts'], examples: ['Post "Hello world"'] }
            ],
            metadata: {
                koshi: {
                    username: 'test_agent',
                    agentKind: 'llm',
                    agentVersion: '1.0.0',
                    agentCapabilities: ['posts:read', 'posts:write'],
                    endpoint: 'https://koshi.ryopc.org/agent/test',
                    callbackUrl: 'https://external.example.com/callback',
                    model: 'gpt-4',
                    provider: 'openai'
                }
            }
        };

        const errors = validateAgentCard(sampleCard, schema);
        if (errors.length > 0) {
            console.log('❌ Sample card validation failed:');
            for (const e of errors) console.log(`   - ${e}`);
            return 1;
        } else {
            console.log('✅ Sample card passes validation');
        }

        // Also verify schema structure
        if (!schema.$schema || !schema.$id || schema.type !== 'object') {
            console.log('❌ Schema missing required metadata');
            return 1;
        }
        console.log('✅ Schema structure valid');

        return 0;
    } catch (err) {
        console.log(`❌ Error: ${err.message}`);
        return 1;
    }
}

const exitCode = main();
process.exit(exitCode);