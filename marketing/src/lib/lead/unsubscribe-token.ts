/**
 * Jeton de désinscription : l'adresse email chiffrée (AES-GCM), illisible dans un lien.
 * Seul le serveur, qui connaît le secret, peut le relire. Un jeton modifié est rejeté.
 * Web Crypto : fonctionne à l'identique dans un Cloudflare Worker et dans Node (tests).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const IV_BYTES = 12;

async function deriveKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(`growcom-desinscription:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function createUnsubscribeToken(email: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(secret);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(email)));
  const token = new Uint8Array(IV_BYTES + cipher.length);
  token.set(iv);
  token.set(cipher, IV_BYTES);
  return toBase64Url(token);
}

/** Adresse email contenue dans le jeton, ou null si le jeton est invalide ou falsifié. */
export async function readUnsubscribeToken(token: string, secret: string): Promise<string | null> {
  if (token.length > 512) return null;
  const bytes = fromBase64Url(token);
  if (!bytes || bytes.length <= IV_BYTES + 16) return null;
  try {
    const key = await deriveKey(secret);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) }, key, bytes.slice(IV_BYTES));
    return decoder.decode(plain);
  } catch {
    return null;
  }
}
