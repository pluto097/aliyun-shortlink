/**
 * Aliyun OSS adapter — the native storage option for Function Compute.
 *
 * Uses the OSS V1 signature (HMAC-SHA1) with `x-oss-date`, so no SDK and no
 * dependency is required, and the `Date` header never has to be set (some
 * proxies rewrite it). Signature verification is covered by the test suite.
 *
 * Notes:
 *   - OSS has no TTL: link expiry is enforced lazily by the link store and
 *     rate-limit counters embed their own expiry inside the value.
 *   - Configure an OSS lifecycle rule (e.g. delete `shortlink/r/` older than
 *     1 day) to garbage-collect rate-limit counters.
 */

import { hmacSha1Base64 } from '../sha1.mjs';

const CONTENT_TYPE = 'application/json; charset=utf-8';

/** Build `<bucket>.<endpoint>` from a bare or scheme-prefixed endpoint. */
function normalizeHost(endpoint, bucket) {
  const cleaned = String(endpoint || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  if (!cleaned) throw new Error('OSS_ENDPOINT is empty');
  return cleaned.startsWith(`${bucket}.`) ? cleaned : `${bucket}.${cleaned}`;
}

/** URL-encode an object key segment by segment, keeping the separators. */
function encodePath(key) {
  return key.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

export function createOssStore(options = {}) {
  const bucket = String(options.bucket || '').trim();
  const accessKeyId = String(options.accessKeyId || '').trim();
  const accessKeySecret = String(options.accessKeySecret || '').trim();
  const securityToken = String(options.securityToken || '').trim();
  const rawPrefix = options.prefix === undefined ? 'shortlink/' : String(options.prefix);
  const prefix = rawPrefix && !rawPrefix.endsWith('/') ? `${rawPrefix}/` : rawPrefix;

  if (!bucket) throw new Error('STORAGE=oss requires OSS_BUCKET');
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('STORAGE=oss requires OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET');
  }

  const host = normalizeHost(options.endpoint, bucket);

  const fullKey = (key) => `${prefix}${key}`;
  const objectUrl = (key) => `https://${host}/${encodePath(fullKey(key))}`;
  const canonicalResource = (key) => `/${bucket}/${fullKey(key)}`;

  async function send(method, key, { body, contentType } = {}) {
    const ossDate = new Date().toUTCString();
    const ossHeaders = { 'x-oss-date': ossDate };
    if (securityToken) ossHeaders['x-oss-security-token'] = securityToken;

    const canonicalHeaders = Object.keys(ossHeaders)
      .sort()
      .map((name) => `${name}:${ossHeaders[name]}\n`)
      .join('');

    // VERB / Content-MD5 / Content-Type / Date / CanonicalizedOSSHeaders+Resource
    const stringToSign = [
      method,
      '',
      contentType ?? '',
      '',
      `${canonicalHeaders}${canonicalResource(key)}`,
    ].join('\n');

    const headers = {
      ...ossHeaders,
      authorization: `OSS ${accessKeyId}:${hmacSha1Base64(accessKeySecret, stringToSign)}`,
    };
    if (contentType) headers['content-type'] = contentType;

    return fetch(objectUrl(key), { method, headers, body });
  }

  async function failure(response, action, key) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // body already consumed or empty
    }
    return new Error(`OSS ${action} ${fullKey(key)} failed with ${response.status}: ${detail}`);
  }

  async function readRaw(key) {
    const response = await send('GET', key);
    if (response.status === 404) return null;
    if (!response.ok) throw await failure(response, 'GET', key);
    return response.text();
  }

  async function writeRaw(key, value) {
    const response = await send('PUT', key, { body: String(value), contentType: CONTENT_TYPE });
    if (!response.ok) throw await failure(response, 'PUT', key);
  }

  return {
    name: 'oss',

    async get(key) {
      return readRaw(key);
    },

    async put(key, value) {
      await writeRaw(key, value);
    },

    async del(key) {
      const response = await send('DELETE', key);
      if (!response.ok && response.status !== 404) throw await failure(response, 'DELETE', key);
    },

    async incr(key, ttlSec) {
      // No atomic counter on OSS: read-modify-write with the expiry embedded
      // in the value, so a stale counter can never block anybody forever.
      const nowSec = Math.floor(Date.now() / 1000);
      const ttl = Number(ttlSec) || 0;
      let count = 0;
      let expiry = 0;

      const raw = await readRaw(key);
      if (raw) {
        const [countPart, expiryPart] = String(raw).split(':');
        const stored = Number.parseInt(expiryPart ?? '0', 10) || 0;
        if (!stored || stored > nowSec) {
          count = Number.parseInt(countPart, 10) || 0;
          // Keep the original expiry: incrementing must not extend the window.
          expiry = stored;
        }
      }

      const next = count + 1;
      if (!expiry) expiry = ttl > 0 ? nowSec + ttl : 0;
      await writeRaw(key, `${next}:${expiry}`);
      return next;
    },
  };
}
