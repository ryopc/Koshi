// ============================================================================
// koshi – Terminal-Native Decentralized SNS
// Ed25519 Cryptographic Utilities
// License: MIT
// ============================================================================
// Provides key generation, signing, and verification using the ed25519
// elliptic curve. Wraps @noble/ed25519 for the heavy lifting (pure JS,
// no native dependencies) and tweetnacl for compatibility.
//
// All keys and signatures are hex-encoded strings for storage and transport.
// ============================================================================

import * as ed from '@noble/ed25519';
import nacl from 'tweetnacl';
import { hexToBytes, bytesToHex } from './utils.js';

/**
 * Generate a new ed25519 keypair.
 *
 * @returns {{ publicKey: string, secretKey: string }}
 *   publicKey  - 64-char hex string (32 bytes)
 *   secretKey  - 128-char hex string (64 bytes, seed + public)
 */
export function generateKeypair() {
    const keypair = nacl.sign.keyPair();
    return {
        publicKey: bytesToHex(keypair.publicKey),
        secretKey: bytesToHex(keypair.secretKey),
    };
}

/**
 * Sign a message with the given secret key.
 *
 * @param {string} message - The message content to sign
 * @param {string} secretKey - Hex-encoded ed25519 secret key (64 bytes = seed+pub or 32 bytes = seed)
 * @returns {Promise<string>} Hex-encoded signature
 */
export async function signMessage(message, secretKey) {
    const skBytes = hexToBytes(secretKey);
    const msgBytes = new TextEncoder().encode(message);
    const signature = await ed.sign(msgBytes, skBytes);
    return bytesToHex(signature);
}

/**
 * Verify a message signature against a public key.
 *
 * @param {string} message - The original message content
 * @param {string} signature - Hex-encoded signature to verify
 * @param {string} publicKey - Hex-encoded ed25519 public key (32 bytes)
 * @returns {Promise<boolean>} Whether the signature is valid
 */
export async function verifySignature(message, signature, publicKey) {
    try {
        const msgBytes = new TextEncoder().encode(message);
        const sigBytes = hexToBytes(signature);
        const pkBytes = hexToBytes(publicKey);
        return await ed.verify(sigBytes, msgBytes, pkBytes);
    } catch (err) {
        // If any input is malformed (wrong length, invalid hex, etc.), return false
        return false;
    }
}

/**
 * Derive the public key from a secret key.
 * Useful when the user only has their secret key stored.
 *
 * @param {string} secretKey - Hex-encoded ed25519 secret key (64 bytes)
 * @returns {string} Hex-encoded public key (32 bytes)
 */
export function derivePublicKey(secretKey) {
    const skBytes = hexToBytes(secretKey);
    // tweetnacl's secretKey is 64 bytes: first 32 = seed, last 32 = public
    // If given only a 32-byte seed, derive from that
    if (skBytes.length === 32) {
        const kp = nacl.sign.keyPair.fromSeed(skBytes);
        return bytesToHex(kp.publicKey);
    }
    // 64-byte secret key: last 32 bytes are the public key
    const publicKeyBytes = skBytes.slice(32, 64);
    return bytesToHex(publicKeyBytes);
}

export default {
    generateKeypair,
    signMessage,
    verifySignature,
    derivePublicKey,
};
