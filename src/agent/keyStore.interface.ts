// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// API Key Storage Interface (TypeScript types for documentation)
// License: MIT
// ============================================================================
// This file defines the interface that both PostgreSQL and SQLite
// implementations must satisfy. Import the actual implementation
// from keyStore.pg.js or keyStore.sqlite.js based on environment.
// ============================================================================

import type { AgentCapability, AgentTier } from './capabilities.js';

/**
 * Raw API key as returned to the user (shown once only).
 * Format: ak_live_<48hex>
 */
export interface RawApiKey {
    key: string;
    prefix: string;
}

/**
 * Stored API key record (without raw key).
 */
export interface StoredApiKey {
    id: string;
    agentId: string;
    keyHash: string;
    keyPrefix: string;
    scopes: AgentCapability[];
    label?: string;
    tier: AgentTier;
    lastUsedAt?: string;
    expiresAt?: string;
    revoked: boolean;
    createdAt: string;
}

/**
 * Input for creating a new API key.
 */
export interface CreateApiKeyInput {
    agentId: string;
    scopes: AgentCapability[];
    label?: string;
    tier?: AgentTier;
    expiresAt?: string; // ISO date string
}

/**
 * Storage interface for API keys.
 * Implementations must provide all methods.
 */
export interface KeyStore {
    /**
     * Generate a new API key, store its hash, return raw key once.
     */
    create(input: CreateApiKeyInput): Promise<{ rawKey: RawApiKey; stored: StoredApiKey }>;

    /**
     * Verify a raw API key against stored hash.
     * Returns stored record if valid and not revoked/expired.
     */
    verify(rawKey: string): Promise<StoredApiKey | null>;

    /**
     * List all API keys for an agent (without raw keys).
     */
    listByAgent(agentId: string): Promise<StoredApiKey[]>;

    /**
     * Revoke an API key by its ID.
     */
    revoke(keyId: string, agentId: string): Promise<boolean>;

    /**
     * Update last_used_at for a key (called on successful verification).
     * Implementations may batch/throttle this.
     */
    touchLastUsed(keyId: string): Promise<void>;

    /**
     * Get a key by ID (for admin operations).
     */
    getById(keyId: string): Promise<StoredApiKey | null>;
}

/**
 * Factory function type for creating the appropriate KeyStore.
 */
export type KeyStoreFactory = (poolOrDb: unknown) => KeyStore;