/**
 * Aliyun ESA "函数和 Pages" Edge KV adapter.
 *
 * Runs only inside an ESA edge function, where EdgeKV is a built-in global:
 *
 *   const kv = new EdgeKV({ namespace: 'shortlink' });
 *   await kv.get(key, { type: 'text' });   // undefined when missing
 *   await kv.put(key, value);              // string | ArrayBuffer | ReadableStream | Response
 *   await kv.delete(key);
 *
 * ESA quirks this adapter absorbs:
 *   1. Keys allow only `[A-Za-z0-9_-]` and max 512 bytes, while the link store
 *      uses `k/`, `d/` and `r/scope/bucket/ip`. Every unsafe character is
 *      escaped as `_` + two hex digits of its UTF-8 bytes, which is injective.
 *   2. There is no TTL argument, so rate-limit counters carry their expiry
 *      inside the value and stale counters are ignored on read.
 */

import { sha256Hex } from '../sha256.mjs';

/** Characters ESA accepts in a key without escaping. */
const SAFE_KEY_CHAR = /[A-Za-z0-9-]/;

/** ESA rejects keys longer than 512 bytes. */
const MAX_KEY_LENGTH = 512;
/** Stay well below the limit before falling back to a hash. */
const HASH_FALLBACK_AT = 480;

const encoder = new TextEncoder();

function hex2(byte) {
  return byte.toString(16).padStart(2, '0');
}

/**
 * Encode a logical store key into an ESA-safe key.
 *
 * Safe characters pass through (`_` itself is escaped), every other character
 * becomes one `_hh` escape per UTF-8 byte, so the mapping is injective:
 * `k/AbC123` -> `k_2fAbC123`.
 *
 * @param {string} logical
 * @returns {string}
 */
export function encodeKey(logical) {
  let out = '';

  for (const char of String(logical)) {
    if (SAFE_KEY_CHAR.test(char)) {
      out += char;
      continue;
    }
    for (const byte of encoder.encode(char)) out += `_${hex2(byte)}`;
  }

  return out;
}

/**
 * @param {{namespace?: string, variables?: Record<string, any>}} options
 */
export function createEsaKvStore(options = {}) {
  const namespace = String(options.namespace || '').trim();
  if (!namespace) {
    throw new Error('STORAGE=esakv requires ESA_KV_NAMESPACE (the Edge KV namespace name)');
  }

  const scope = options.variables ?? globalThis;
  const EdgeKvConstructor = scope?.EdgeKV;

  if (typeof EdgeKvConstructor !== 'function') {
    throw new Error(
      'EdgeKV is not available in this runtime: the esakv adapter only runs inside an Aliyun ESA edge function',
    );
  }

  const kv = new EdgeKvConstructor({ namespace });

  /** Resolve a logical key, falling back to a hash for pathologically long keys. */
  async function physicalKey(logical) {
    const encoded = encodeKey(logical);
    if (encoded.length <= HASH_FALLBACK_AT) return encoded;
    return `h_${await sha256Hex(String(logical))}`;
  }

  async function readValue(logical) {
    const value = await kv.get(await physicalKey(logical), { type: 'text' });
    if (value === undefined || value === null) return null;
    return String(value);
  }

  async function writeValue(logical, value) {
    await kv.put(await physicalKey(logical), String(value));
  }

  return {
    name: 'esakv',

    async get(logical) {
      return readValue(logical);
    },

    async put(logical, value) {
      // ESA KV has no TTL parameter; link expiry is enforced lazily by the
      // link store through the envelope it writes.
      await writeValue(logical, value);
    },

    async del(logical) {
      await kv.delete(await physicalKey(logical));
    },

    async incr(logical, ttlSec) {
      const nowSec = Math.floor(Date.now() / 1000);
      const ttl = Number(ttlSec) || 0;
      let count = 0;
      let expiry = 0;

      const raw = await readValue(logical);
      if (raw) {
        const [countPart, expiryPart] = String(raw).split(':');
        const stored = Number.parseInt(expiryPart ?? '0', 10) || 0;
        if (!stored || stored > nowSec) {
          count = Number.parseInt(countPart, 10) || 0;
          expiry = stored;
        }
      }

      const next = count + 1;
      if (!expiry) expiry = ttl > 0 ? nowSec + ttl : 0;
      await writeValue(logical, `${next}:${expiry}`);
      return next;
    },
  };
}

export { MAX_KEY_LENGTH };
