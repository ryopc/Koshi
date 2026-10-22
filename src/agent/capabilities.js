// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Agent Capabilities & Validation
// License: MIT
// ============================================================================
// Defines all available agent capabilities (scopes) and validation logic.
// ============================================================================

/**
 * All supported agent capabilities (scopes).
 * These are the canonical strings used in API keys, agent profiles, and middleware.
 */
export const AGENT_CAPABILITIES = [
    'posts:read',
    'posts:write',
    'dms:read',
    'dms:write',
    'groups:read',
    'groups:write',
    'users:read',
    'events:read',
    'events:write',
    'admin:read'
];

/**
 * Valid agent kinds.
 */
export const AGENT_KINDS = ['llm', 'bot', 'automation', 'service'];

/**
 * Valid agent tiers (for rate limiting).
 */
export const AGENT_TIERS = ['free', 'standard', 'trusted'];

/**
 * Capability metadata for documentation and UI.
 */
export const CAPABILITY_METADATA = {
    'posts:read': { description: '投稿の閲覧', category: 'Posts' },
    'posts:write': { description: '投稿の作成', category: 'Posts' },
    'dms:read': { description: 'DM の受信箱閲覧', category: 'Direct Messages' },
    'dms:write': { description: 'DM の送信', category: 'Direct Messages' },
    'groups:read': { description: 'グループとメッセージの閲覧', category: 'Groups' },
    'groups:write': { description: 'グループの作成・参加・投稿', category: 'Groups' },
    'users:read': { description: 'ユーザー検索とプロフィール閲覧', category: 'Users' },
    'events:read': { description: 'イベントストリームの購読', category: 'Events' },
    'events:write': { description: 'Webhook 購読の設定', category: 'Events' },
    'admin:read': { description: '管理情報の閲覧', category: 'Admin' }
};

/**
 * Tier configuration for rate limiting multipliers.
 */
export const TIER_CONFIG = {
    free: { multiplier: 1, description: 'Basic tier for new agents' },
    standard: { multiplier: 2, description: 'Standard tier for verified agents' },
    trusted: { multiplier: 5, description: 'Trusted tier for approved agents' }
};

/**
 * Validate that all capabilities are known.
 * @param {string[]} capabilities - Array of capability strings
 * @returns {{ valid: boolean, invalid: string[] }}
 */
export function validateCapabilities(capabilities) {
    const invalid = capabilities.filter(c => !AGENT_CAPABILITIES.includes(c));
    return { valid: invalid.length === 0, invalid };
}

/**
 * Validate agent kind.
 */
export function validateAgentKind(kind) {
    return AGENT_KINDS.includes(kind);
}

/**
 * Validate tier.
 */
export function validateTier(tier) {
    return AGENT_TIERS.includes(tier);
}

/**
 * Check if a capability implies another (for hierarchical scopes).
 * Currently flat - no implications.
 */
export function implies(cap, other) {
    return cap === other;
}

/**
 * Get all capabilities grouped by category.
 */
export function getCapabilitiesByCategory() {
    const groups = {};
    for (const cap of AGENT_CAPABILITIES) {
        const cat = CAPABILITY_METADATA[cap].category;
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(cap);
    }
    return groups;
}

/**
 * Normalize capabilities array (deduplicate, validate).
 */
export function normalizeCapabilities(capabilities) {
    const unique = [...new Set(capabilities)];
    const { valid, invalid } = validateCapabilities(unique);
    if (!valid) {
        throw new Error(`Invalid capabilities: ${invalid.join(', ')}`);
    }
    return unique;
}