/**
 * Storage facade.
 *
 * Adapters speak plain strings; `LinkStore` owns the value format and the
 * keyspace so every adapter behaves identically:
 *
 *   k/<code>      link record   {"v":1,"u":"https://…","c":<created>,"e":<expires|0>}
 *   d/<sha256>    dedup index   <code>
 *   r/<scope>/…   rate counters (adapters may use their own encoding)
 *
 * Legacy rows written by cf-shortlink-worker (a bare URL string) are still
 * readable, which makes migrating an existing KV namespace painless.
 */

import { sha256Hex } from '../sha256.mjs';
import { createCfkvStore } from './cfkv.mjs';
import { createEsaKvStore } from './esakv.mjs';
import { createMemoryStore } from './memory.mjs';
import { createOssStore } from './oss.mjs';
import { createUpstashStore } from './upstash.mjs';

const LINK_PREFIX = 'k/';
const DEDUP_PREFIX = 'd/';

/**
 * Decide which adapter to use: explicit STORAGE wins, otherwise auto-detect.
 * @param {{storage: string, oss: object, upstash: object, esakv: object}} config
 * @param {Record<string, any>} env
 */
export function resolveStorageKind(config, env = {}) {
  const requested = config?.storage ?? 'auto';
  if (requested && requested !== 'auto') return requested;

  if (env?.LINKS && typeof env.LINKS.get === 'function') return 'cfkv';
  if (typeof globalThis.EdgeKV === 'function') return 'esakv';
  if (config?.oss?.bucket && config?.oss?.accessKeySecret) return 'oss';
  if (config?.upstash?.url) return 'upstash';
  return 'memory';
}

/**
 * Instantiate the storage adapter.
 * @param {{storage: string, oss: object, upstash: object}} config
 * @param {Record<string, any>} env
 */
export function buildAdapter(config, env = {}) {
  const kind = resolveStorageKind(config, env);

  switch (kind) {
    case 'cfkv':
      return createCfkvStore(env?.LINKS);

    case 'oss':
      return createOssStore(config.oss);

    case 'esakv':
      return createEsaKvStore(config.esakv);

    case 'upstash':
      return createUpstashStore(config.upstash);

    case 'memory':
      console.warn('[shortlink] using the in-memory store: links are lost on restart');
      return createMemoryStore();

    default:
      throw new Error(`Unknown STORAGE value "${kind}" (expected auto|memory|cfkv|upstash|oss)`);
  }
}

/**
 * Create the link store on top of the resolved adapter.
 * @param {object} config
 * @param {Record<string, any>} env
 * @param {{now?: () => number}} [options]
 */
export async function createStore(config, env = {}, options = {}) {
  return new LinkStore(buildAdapter(config, env), options);
}

export { sha256Hex };

/** Decode a stored value, accepting both the envelope and legacy raw URLs. */
function parseEnvelope(raw) {
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.u === 'string') {
        return { u: parsed.u, c: Number(parsed.c) || 0, e: Number(parsed.e) || 0 };
      }
    } catch {
      // fall through to legacy handling
    }
  }
  return { u: raw, c: 0, e: 0 };
}

export class LinkStore {
  /**
   * @param {{name: string, get: Function, put: Function, del: Function, incr: Function}} adapter
   * @param {{now?: () => number, cacheTtlSec?: number, cacheMax?: number}} [options]
   */
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.now = options.now ?? (() => Date.now());
    // Write-through cache for links this isolate just created. Distributed KV
    // (Cloudflare KV, ESA Edge KV) propagates writes asynchronously, so without
    // this a user who opens a freshly created short link can hit a 404.
    this.cacheTtlSec = Math.max(0, Number(options.cacheTtlSec ?? 300) || 0);
    this.cacheMax = Math.max(1, Number(options.cacheMax ?? 500) || 500);
    /** @type {Map<string, {link: object, cachedUntil: number}>} */
    this.recent = new Map();
  }

  get name() {
    return this.adapter.name;
  }

  nowSeconds() {
    return Math.floor(this.now() / 1000);
  }

  /** Remember a link we just wrote so immediate reads succeed. */
  rememberLink(code, link) {
    if (this.cacheTtlSec <= 0) return;
    if (this.recent.size >= this.cacheMax) {
      const oldest = this.recent.keys().next();
      if (!oldest.done) this.recent.delete(oldest.value);
    }
    this.recent.set(code, { link, cachedUntil: this.now() + this.cacheTtlSec * 1000 });
  }

  /** Cached link for `code`, or null when absent/stale. */
  cachedLink(code) {
    const entry = this.recent.get(code);
    if (!entry) return null;
    if (entry.cachedUntil <= this.now()) {
      this.recent.delete(code);
      return null;
    }
    const { link } = entry;
    if (link.expiresAt > 0 && link.expiresAt <= this.nowSeconds()) {
      this.recent.delete(code);
      return null;
    }
    return { ...link };
  }

  /**
   * Resolve a code to a live link record, deleting it when it has expired.
   * @param {string} code
   */
  async getLink(code) {
    const cached = this.cachedLink(code);
    if (cached) return cached;

    const key = `${LINK_PREFIX}${code}`;
    const raw = await this.adapter.get(key);
    if (!raw) return null;

    const envelope = parseEnvelope(raw);
    const nowSec = this.nowSeconds();
    if (envelope.e > 0 && envelope.e <= nowSec) {
      await this.adapter.del(key).catch(() => {});
      return null;
    }

    return { code, url: envelope.u, createdAt: envelope.c, expiresAt: envelope.e };
  }

  /**
   * Persist a code -> URL mapping.
   * @param {string} code
   * @param {string} url
   * @param {{ttlSec?: number}} [opts]
   */
  async putLink(code, url, opts = {}) {
    const ttlSec = Number(opts.ttlSec) || 0;
    const nowSec = this.nowSeconds();
    const envelope = { v: 1, u: url, c: nowSec, e: ttlSec > 0 ? nowSec + ttlSec : 0 };
    await this.adapter.put(
      `${LINK_PREFIX}${code}`,
      JSON.stringify(envelope),
      ttlSec > 0 ? { ttlSec } : {},
    );

    this.rememberLink(code, { code, url, createdAt: nowSec, expiresAt: envelope.e });
  }

  /** Remove a code. */
  async deleteLink(code) {
    this.recent.delete(code);
    await this.adapter.del(`${LINK_PREFIX}${code}`);
  }

  /**
   * Look up an existing code for the same long URL (dedup index).
   * @param {string} url
   * @returns {Promise<string|null>}
   */
  async resolveDedup(url) {
    const code = await this.adapter.get(`${DEDUP_PREFIX}${await sha256Hex(url)}`);
    return code ? String(code) : null;
  }

  /**
   * Remember a long URL -> code mapping for `ttlSec` seconds.
   * @param {string} url
   * @param {string} code
   * @param {number} ttlSec
   */
  async rememberDedup(url, code, ttlSec) {
    const ttl = Number(ttlSec) || 0;
    await this.adapter.put(
      `${DEDUP_PREFIX}${await sha256Hex(url)}`,
      String(code),
      ttl > 0 ? { ttlSec: ttl } : {},
    );
  }

  /**
   * Increment a counter (rate limiting).
   * @param {string} key
   * @param {number} ttlSec
   */
  async incr(key, ttlSec) {
    return this.adapter.incr(key, ttlSec);
  }
}
