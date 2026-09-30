import crypto from 'crypto';
import { config } from '../config';

// National IDs are stored encrypted (AES-256-GCM) plus a keyed hash for lookup
// and uniqueness, so the plain number never sits in the database.

const PREFIX = 'pii1';
const encKey = crypto.createHash('sha256').update(config.PII_ENCRYPTION_KEY).digest();

export function encryptPii(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join(':');
}

export function decryptPii(value: string): string {
  const [prefix, iv, tag, data] = value.split(':');
  if (prefix !== PREFIX || !iv || !tag || !data) throw new Error('Not an encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function hashPii(value: string): string {
  return crypto.createHmac('sha256', config.PII_HASH_KEY).update(value).digest('hex');
}

/** 2990101•••••23 — enough for staff to recognise an ID without exposing it. */
export function maskNationalId(nid: string): string {
  return nid.length === 14 ? `${nid.slice(0, 7)}•••••${nid.slice(12)}` : '••••';
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
