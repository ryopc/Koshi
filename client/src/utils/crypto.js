import nacl from 'tweetnacl';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Fix for ESM read-only module namespace: pass etc to signAsync
const etc = {
    sha512Sync: (data) => sha512(data),
};

const enc = new TextEncoder();

export const hex = (b) =>
  Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

export const dehex = (h) => {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return b;
};

// Use tweetnacl for keypair generation (no etc needed)
export async function generateKeypair() {
  const keypair = nacl.sign.keyPair();
  return {
    secretKey: hex(keypair.secretKey),
    publicKey: hex(keypair.publicKey),
    rawSecretKey: keypair.secretKey,
  };
}

// Use @noble/ed25519 signAsync with etc option
export async function signMessage(message, secretKeyHex) {
  const skBytes = dehex(secretKeyHex);
  // tweetnacl secretKey is 64 bytes (seed + public), noble expects 32-byte seed
  const seedBytes = skBytes.length === 64 ? skBytes.slice(0, 32) : skBytes;
  const sig = await ed.signAsync(enc.encode(message), seedBytes, etc);
  return hex(sig);
}