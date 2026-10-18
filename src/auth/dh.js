// ============================================================================
// koshi – Terminal-Native Decentralized SNS v3.1.6
// DM Encryption (ed25519 → x25519 + tweetnacl box)
// License: MIT
// ============================================================================
// In serverless P2P mode there is no central server to trust, so DMs must be
// end-to-end encrypted. We convert the existing ed25519 keys to x25519
// (RFC 7748 / ed2curve) and use nacl.box (X25519 + XSalsa20-Poly1305).
//
// Only the intended recipient (who holds the matching secret key) can decrypt.
// Everyone else on the gossip mesh only sees ciphertext.
// ============================================================================

import nacl from 'tweetnacl';
import ed2curve from 'ed2curve';
import { hexToBytes, bytesToHex } from './utils.js';

/**
 * Convert an ed25519 secret key (hex) to an x25519 secret key.
 *
 * @param {string} edSecretKeyHex - 64-char (32-byte seed) or 128-char (64-byte) hex
 * @returns {Uint8Array} 32-byte x25519 secret key
 */
export function edSecretToX25519(edSecretKeyHex) {
    let sk = hexToBytes(edSecretKeyHex);
    // tweetnacl stores 64 bytes (seed + public); ed2curve wants the 32-byte seed
    if (sk.length === 64) sk = sk.slice(0, 32);
    const x = ed2curve.convertSecretKey(sk);
    if (!x) throw new Error('Invalid ed25519 secret key for x25519 conversion.');
    return x;
}

/**
 * Convert an ed25519 public key (hex) to an x25519 public key.
 *
 * @param {string} edPublicKeyHex - 64-char hex (32 bytes)
 * @returns {Uint8Array} 32-byte x25519 public key
 */
export function edPublicToX25519(edPublicKeyHex) {
    const x = ed2curve.convertPublicKey(hexToBytes(edPublicKeyHex));
    if (!x) throw new Error('Invalid ed25519 public key for x25519 conversion.');
    return x;
}

/**
 * Encrypt a plaintext message for a recipient.
 *
 * @param {string} plaintext - Message content
 * @param {string} senderSecretKeyHex - Sender's ed25519 secret key (hex)
 * @param {string} recipientPublicKeyHex - Recipient's ed25519 public key (hex)
 * @returns {{ encrypted: string, nonce: string }} base64 ciphertext + nonce
 */
export function encryptFor(plaintext, senderSecretKeyHex, recipientPublicKeyHex) {
    const xsk = edSecretToX25519(senderSecretKeyHex);
    const xpk = edPublicToX25519(recipientPublicKeyHex);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const msg = new TextEncoder().encode(plaintext);
    const boxed = nacl.box(msg, nonce, xpk, xsk);
    return {
        encrypted: Buffer.from(boxed).toString('base64'),
        nonce: Buffer.from(nonce).toString('base64'),
    };
}

/**
 * Decrypt a ciphertext received from a sender.
 *
 * @param {string} encrypted - base64 ciphertext
 * @param {string} nonce - base64 nonce
 * @param {string} senderPublicKeyHex - Sender's ed25519 public key (hex)
 * @param {string} recipientSecretKeyHex - Recipient's ed25519 secret key (hex)
 * @returns {string|null} Plaintext, or null if decryption fails
 */
export function decryptFrom(encrypted, nonce, senderPublicKeyHex, recipientSecretKeyHex) {
    try {
        const xsk = edSecretToX25519(recipientSecretKeyHex);
        const xpk = edPublicToX25519(senderPublicKeyHex);
        const boxed = Uint8Array.from(Buffer.from(encrypted, 'base64'));
        const nonceBytes = Uint8Array.from(Buffer.from(nonce, 'base64'));
        const opened = nacl.box.open(boxed, nonceBytes, xpk, xsk);
        if (!opened) return null;
        return new TextDecoder().decode(opened);
    } catch {
        return null;
    }
}

/**
 * Encrypt a DM payload for the recipient and return the block fields.
 */
export function encryptDMBlock(plaintext, senderSecretKeyHex, recipientPublicKeyHex) {
    const { encrypted, nonce } = encryptFor(plaintext, senderSecretKeyHex, recipientPublicKeyHex);
    return { encrypted, nonce };
}

/**
 * Decrypt a DM block. Returns plaintext or null.
 */
export function decryptDMBlock(block, recipientSecretKeyHex) {
    if (!block?.encrypted || !block?.nonce || !block.fromPubkey) return null;
    return decryptFrom(block.encrypted, block.nonce, block.fromPubkey, recipientSecretKeyHex);
}

export default {
    encryptFor,
    decryptFrom,
    encryptDMBlock,
    decryptDMBlock,
    edSecretToX25519,
    edPublicToX25519,
};
