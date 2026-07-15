// Ed25519 crypto utilities using @noble/ed25519
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'

// Required for @noble/ed25519 v2
// @noble/ed25519 v2 requires setting sha512Sync for sync operations
ed.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => {
  const merged = new Uint8Array(m.reduce((sum, a) => sum + a.length, 0))
  let offset = 0
  for (const a of m) { merged.set(a, offset); offset += a.length }
  return sha512(merged)
}

export interface KeyPair {
  publicKey: string  // hex
  secretKey: string  // hex
}

export function generateKeyPair(): KeyPair {
  const secretKey = ed.utils.randomPrivateKey()
  const publicKey = ed.getPublicKey(secretKey)
  return {
    secretKey: encodeHex(secretKey),
    publicKey: encodeHex(publicKey),
  }
}

export function signMessage(message: string, secretKeyHex: string): string {
  const secretKey = decodeHex(secretKeyHex)
  const msgBytes = new TextEncoder().encode(message)
  const signature = ed.sign(msgBytes, secretKey)
  return encodeHex(signature)
}

export function verifySignature(
  message: string,
  signatureHex: string,
  publicKeyHex: string
): boolean {
  try {
    const msgBytes = new TextEncoder().encode(message)
    return ed.verify(decodeHex(signatureHex), msgBytes, decodeHex(publicKeyHex))
  } catch {
    return false
  }
}

export function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function decodeHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}
