import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Chiffre une chaîne avec AES-256-GCM.
 * Format stocké : iv_hex:authTag_hex:ciphertext_hex
 */
export function encrypt(plaintext: string): string {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Déchiffre une chaîne chiffrée par encrypt().
 * Si le format ne correspond pas (valeur ancienne en clair), retourne la valeur telle quelle.
 */
export function decrypt(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 3) {
    // Valeur non chiffrée (migration depuis l'ancien format) — retourne telle quelle
    return value;
  }

  try {
    const [ivHex, authTagHex, ciphertextHex] = parts;
    const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
  } catch {
    // En cas d'échec (ex: valeur corrompue ou ancienne), retourne telle quelle
    return value;
  }
}
