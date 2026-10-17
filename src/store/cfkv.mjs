/**
 * Cloudflare KV adapter (Pages Functions / Workers `LINKS` binding).
 *
 * KV has no atomic increment; counters are read-modify-write and therefore
 * approximate. That is acceptable for abuse throttling. KV also enforces a
 * 60 second minimum `expirationTtl`, which we clamp to.
 */

const MIN_TTL_SEC = 60;

export function createCfkvStore(binding) {
  if (!binding || typeof binding.get !== 'function' || typeof binding.put !== 'function') {
    throw new Error('Cloudflare KV binding "LINKS" is missing or invalid');
  }

  return {
    name: 'cfkv',

    async get(key) {
      const value = await binding.get(key);
      return typeof value === 'string' ? value : null;
    },

    async put(key, value, opts = {}) {
      const ttl = Number(opts?.ttlSec) || 0;
      const options = ttl > 0 ? { expirationTtl: Math.max(MIN_TTL_SEC, Math.trunc(ttl)) } : undefined;
      await binding.put(key, String(value), options);
    },

    async del(key) {
      await binding.delete(key);
    },

    async incr(key, ttlSec) {
      const current = Number.parseInt((await this.get(key)) ?? '0', 10) || 0;
      const next = current + 1;
      await this.put(key, String(next), { ttlSec });
      return next;
    },
  };
}
