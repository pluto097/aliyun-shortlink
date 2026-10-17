/**
 * Upstash Redis REST adapter.
 *
 * Pure `fetch`, so it works unchanged on Cloudflare Workers and Aliyun FC.
 * `INCR` gives us an atomic rate limit counter, unlike KV.
 */

export function createUpstashStore(options = {}) {
  const url = String(options.url || '').trim().replace(/\/+$/, '');
  const token = String(options.token || '').trim();

  if (!url) throw new Error('STORAGE=upstash requires UPSTASH_REDIS_REST_URL');
  if (!token) throw new Error('STORAGE=upstash requires UPSTASH_REDIS_REST_TOKEN');

  /**
   * Run a single Redis command through the REST API.
   * @param {string[]} args
   */
  async function command(args) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
    });

    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`Upstash returned a non-JSON response (${response.status}): ${raw.slice(0, 200)}`);
    }

    if (!response.ok || payload.error) {
      throw new Error(`Upstash command ${args[0]} failed (${response.status}): ${payload.error || raw.slice(0, 200)}`);
    }

    return payload.result ?? null;
  }

  return {
    name: 'upstash',

    async get(key) {
      const result = await command(['GET', key]);
      return result === null || result === undefined ? null : String(result);
    },

    async put(key, value, opts = {}) {
      const ttl = Number(opts?.ttlSec) || 0;
      if (ttl > 0) await command(['SET', key, String(value), 'EX', String(Math.trunc(ttl))]);
      else await command(['SET', key, String(value)]);
    },

    async del(key) {
      await command(['DEL', key]);
    },

    async incr(key, ttlSec) {
      const count = Number(await command(['INCR', key]));
      const ttl = Number(ttlSec) || 0;
      if (count === 1 && ttl > 0) await command(['EXPIRE', key, String(Math.trunc(ttl))]);
      return count;
    },
  };
}
