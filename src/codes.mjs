/**
 * Short code generation and validation.
 *
 * The alphabet intentionally excludes visually ambiguous characters
 * (0/O, 1/l/I) so codes survive being read aloud or copied off a screen.
 * Codes are case sensitive and CSPRNG-generated.
 */

export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const CODE_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const MIN_CODE_LENGTH = 3;
const MAX_CODE_LENGTH = 64;

/** Rejection sampling bound, so every character stays uniformly distributed. */
const REJECTION_BOUND = 256 - (256 % ALPHABET.length);

/**
 * Paths that must never be claimed by a short code, otherwise they would
 * shadow real routes (and break the service on the next request).
 */
export const RESERVED_CODES = new Set([
  'api',
  'short',
  'healthz',
  'favicon.ico',
  'robots.txt',
  'index.html',
  'admin',
  'login',
  'logout',
  'signup',
  'assets',
  'static',
  '_next',
]);

/**
 * Generate a random short code.
 * @param {number} [length]
 * @returns {string}
 */
export function generateCode(length = 7) {
  const size = Math.min(MAX_CODE_LENGTH, Math.max(MIN_CODE_LENGTH, Math.trunc(length) || 7));
  const out = [];
  const bytes = new Uint8Array(size * 2);

  while (out.length < size) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= REJECTION_BOUND) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === size) break;
    }
  }

  return out.join('');
}

/**
 * Whether a user supplied code is shaped like a valid code.
 * @param {unknown} code
 * @returns {boolean}
 */
export function isValidCustomCode(code) {
  return typeof code === 'string' && CODE_PATTERN.test(code);
}

/**
 * Whether a code would collide with a real route.
 * @param {string} code
 * @returns {boolean}
 */
export function isReservedCode(code) {
  return RESERVED_CODES.has(String(code).toLowerCase());
}
