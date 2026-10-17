// koshi – CLI i18n module
// License: MIT

/**
 * Simple i18n system for the koshi CLI.
 * Supports English (en) and Japanese (ja).
 *
 * Language is selected via:
 *   1. KOSHI_LANG environment variable (e.g., KOSHI_LANG=ja)
 *   2. LANG environment variable (e.g., LANG=ja_JP.UTF-8)
 *   3. Defaults to English
 */

import en from './locales/en.js';
import ja from './locales/ja.js';

const locales = { en, ja };

function detectLanguage() {
    if (process.env.KOSHI_LANG === 'ja' || process.env.KOSHI_LANG === 'en') {
        return process.env.KOSHI_LANG;
    }
    const lang = process.env.LANG || '';
    if (lang.startsWith('ja')) return 'ja';
    return 'en';
}

export const lang = detectLanguage();
const _translations = locales[lang] || locales.en;

/**
 * Translate a key path (e.g., 'serve.banner') to the current language.
 * @param {string} key - Dot-separated key path
 * @param {object} [params={}] - Parameters to inject into the translation
 * @returns {string} Translated string
 */
export function t(key, params = {}) {
    const keys = key.split('.');
    let result = _translations;
    for (const k of keys) {
        if (result && typeof result === 'object' && k in result) {
            result = result[k];
        } else {
            return key; // Fallback to key if not found
        }
    }
    if (typeof result !== 'string') return key;
    // Inject params like {username}
    return result.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}

export function getLanguage() {
    return lang;
}

export default { t, getLanguage };
