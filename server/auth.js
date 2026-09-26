// Password hashing, session tokens and login rate limiting.
import { scrypt as scryptCb, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEYLEN = 32;
const N = 16384, R = 8, P = 1;

export const SESSION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
export const USERNAME_RE = /^[a-z0-9_.-]{1,32}$/;
export const MIN_PASSWORD = 8;

export const normalizeUsername = (s) => String(s ?? '').trim().toLowerCase();

/** Returns `scrypt$N$r$p$salt$hash` with base64 salt and hash. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

// Used when the username doesn't exist, so a wrong name takes as long as a wrong password.
const DUMMY = await hashPassword(randomBytes(16).toString('hex'));

export async function verifyPassword(password, stored) {
  const [kind, n, r, p, saltB64, hashB64] = String(stored || DUMMY).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected) && Boolean(stored);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const sessionExpiry = (now = Date.now()) => now + SESSION_DAYS * DAY;
/** Sessions slide: once less than half the lifetime is left, a request extends it. */
export const needsRenewal = (expiresAt, now = Date.now()) => expiresAt - now < (SESSION_DAYS / 2) * DAY;

/**
 * Counts failed logins per key (an IP or a username) in a sliding window.
 * After `max` failures the key is blocked until the oldest failure ages out.
 */
export function rateLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const fails = new Map();
  const recent = (key, now) => (fails.get(key) || []).filter((t) => now - t < windowMs);
  return {
    blocked(keys, now = Date.now()) {
      return keys.some((k) => recent(k, now).length >= max);
    },
    fail(keys, now = Date.now()) {
      for (const k of keys) fails.set(k, [...recent(k, now), now]);
      if (fails.size > 10_000) for (const [k] of fails) if (!recent(k, now).length) fails.delete(k);
    },
    reset(keys) {
      for (const k of keys) fails.delete(k);
    },
  };
}
