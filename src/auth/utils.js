// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Hex Encoding/Decoding Utilities
// License: MIT
// ============================================================================

/**
 * Convert a hex string to a Uint8Array (byte array).
 * @param {string} hex - Hex-encoded string
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
    if (typeof hex !== 'string') {
        throw new TypeError('Expected a hex string');
    }
    if (hex.length % 2 !== 0) {
        throw new Error('Hex string must have an even number of characters');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Convert a Uint8Array (byte array) to a hex string.
 * @param {Uint8Array} bytes - Byte array
 * @returns {string}
 */
export function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Generate a random hex string of the given byte length.
 * @param {number} byteLength - Number of random bytes
 * @returns {string} Hex-encoded random string
 */
export function randomHex(byteLength = 32) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
}
