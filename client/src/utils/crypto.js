import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512.js';

// Load noble ed25519 from local npm package (bundled by Vite, no esm.sh fetch)
let edModule = null;

async function getEd() {
  if (!edModule) {
    edModule = ed;
    edModule.etc = edModule.etc || {};
    edModule.etc.sha512Sync = (...m) => {
      const total = m.reduce((s, a) => s + a.length, 0);
      const merged = new Uint8Array(total);
      let o = 0;
      for (const a of m) { merged.set(a, o); o += a.length; }
      return sha512(merged);
    };
  }
  return edModule;
}

const enc = new TextEncoder();

export const hex = (b) =>
  Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

export const dehex = (h) => {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) b[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return b;
};

export async function generateKeypair() {
  const ed = await getEd();
  const sk = ed.utils.randomPrivateKey();
  const pk = ed.getPublicKey(sk);
  return { secretKey: hex(sk), publicKey: hex(pk), rawSecretKey: sk };
}

export async function signMessage(message, secretKeyHex) {
  const ed = await getEd();
  return hex(ed.sign(enc.encode(message), dehex(secretKeyHex)));
}
