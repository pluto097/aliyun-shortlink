/**
 * In-memory adapter: local development and tests.
 * Data lives in the process, so every cold start starts empty.
 */

export function createMemoryStore(options = {}) {
  const now = options.now ?? (() => Date.now());
  const maxEntries = Math.max(1, options.maxEntries ?? 10_000);
  /** @type {Map<string, {value: string, expiresAt: number}>} */
  const map = new Map();

  function live(key) {
    const record = map.get(key);
    if (!record) return null;
    if (record.expiresAt !== 0 && record.expiresAt <= now()) {
      map.delete(key);
      return null;
    }
    return record;
  }

  function evictOne() {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }

  function expiryFor(ttlSec) {
    const ttl = Number(ttlSec) || 0;
    return ttl > 0 ? now() + ttl * 1000 : 0;
  }

  return {
    name: 'memory',

    async get(key) {
      return live(key)?.value ?? null;
    },

    async put(key, value, opts = {}) {
      if (!map.has(key)) {
        while (map.size >= maxEntries) evictOne();
      }
      map.set(key, { value: String(value), expiresAt: expiryFor(opts?.ttlSec) });
    },

    async del(key) {
      map.delete(key);
    },

    async incr(key, ttlSec) {
      const record = live(key);
      if (!record) {
        while (map.size >= maxEntries) evictOne();
        map.set(key, { value: '1', expiresAt: expiryFor(ttlSec) });
        return 1;
      }
      const count = (Number.parseInt(record.value, 10) || 0) + 1;
      record.value = String(count);
      return count;
    },

    /** Test helper: current number of live keys. */
    size() {
      return map.size;
    },
  };
}
