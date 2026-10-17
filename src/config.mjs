/**
 * Environment -> config normalization.
 *
 * Both platforms hand us a flat key/value map:
 *   - Cloudflare Pages / Workers: the `env` bindings object (KV namespace lives on `env.LINKS`)
 *   - Aliyun Function Compute: `process.env`
 *
 * Environment values are only trusted when they are strings, so a KV binding
 * object can never leak into a string field by accident.
 */

const STORAGE_KINDS = new Set(['auto', 'memory', 'cfkv', 'esakv', 'upstash', 'oss']);
const CORS_MODES = new Set(['open', 'list', 'off']);

const DEFAULTS = {
  pageTitle: 'ShortLink',
  pageIcon: '🔗',
  pageDesc: 'Simple, fast, and secure short links.',
  corsMode: 'open',
  rlWindowSec: 60,
  rlMaxReq: 10,
  dedupTtlSec: 0,
  codeLength: 7,
};

/** Read an env value as a trimmed string (numbers are accepted, objects rejected). */
function str(env, key) {
  const value = env ? env[key] : undefined;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Read an env value as an integer clamped into [min, max], falling back to `fallback`. */
function int(env, key, fallback, min, max) {
  const raw = str(env, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Strip trailing slashes so short URLs never end up with a double slash. */
function trimBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

/** Compile `BLOCK_HOSTS` (comma separated regexes) into matchers, skipping invalid patterns. */
function readBlockHosts(env) {
  const raw = str(env, 'BLOCK_HOSTS');
  if (!raw) return [];
  const matchers = [];
  for (const part of raw.split(',')) {
    const pattern = part.trim();
    if (!pattern) continue;
    try {
      matchers.push(new RegExp(pattern, 'i'));
    } catch {
      console.warn(`[shortlink] ignoring invalid BLOCK_HOSTS pattern: ${pattern}`);
    }
  }
  return matchers;
}

function readStorage(env) {
  const value = str(env, 'STORAGE').toLowerCase();
  return STORAGE_KINDS.has(value) ? value : 'auto';
}

function readCorsMode(env) {
  const value = str(env, 'CORS_MODE').toLowerCase();
  return CORS_MODES.has(value) ? value : DEFAULTS.corsMode;
}

function readOrigins(env) {
  const raw = str(env, 'CORS_ORIGINS');
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Build the normalized config.
 * @param {Record<string, unknown>} env
 */
export function readConfig(env = {}) {
  const pageTitle = str(env, 'PAGE_TITLE') || DEFAULTS.pageTitle;
  const createToken = str(env, 'CREATE_TOKEN');

  return {
    storage: readStorage(env),
    baseUrl: trimBaseUrl(str(env, 'BASE_URL')),

    pageTitle,
    pageIcon: str(env, 'PAGE_ICON') || DEFAULTS.pageIcon,
    pageDesc: str(env, 'PAGE_DESC') || DEFAULTS.pageDesc,

    corsMode: readCorsMode(env),
    corsOrigins: readOrigins(env),

    // rlMaxReq <= 0 disables rate limiting entirely.
    rlWindowSec: int(env, 'RL_WINDOW_SEC', DEFAULTS.rlWindowSec, 1, 86_400),
    rlMaxReq: int(env, 'RL_MAX_REQ', DEFAULTS.rlMaxReq, 0, 1_000_000),

    dedupTtlSec: int(env, 'DEDUP_TTL_SEC', DEFAULTS.dedupTtlSec, 0, 31_536_000),
    codeLength: int(env, 'CODE_LENGTH', DEFAULTS.codeLength, 4, 32),

    // In-isolate write-through cache for freshly created links. Distributed KV
    // propagates writes asynchronously (ESA Edge KV: seconds up to 300 s).
    localCacheTtlSec: int(env, 'LOCAL_CACHE_TTL_SEC', 300, 0, 86_400),

    createToken,
    blockHosts: readBlockHosts(env),

    oss: {
      bucket: str(env, 'OSS_BUCKET'),
      endpoint: str(env, 'OSS_ENDPOINT') || 'oss-cn-hangzhou.aliyuncs.com',
      accessKeyId: str(env, 'OSS_ACCESS_KEY_ID'),
      accessKeySecret: str(env, 'OSS_ACCESS_KEY_SECRET'),
      securityToken: str(env, 'OSS_SECURITY_TOKEN'),
      prefix: str(env, 'OSS_PREFIX') || 'shortlink/',
    },

    upstash: {
      url: str(env, 'UPSTASH_REDIS_REST_URL') || str(env, 'KV_REST_API_URL'),
      token: str(env, 'UPSTASH_REDIS_REST_TOKEN') || str(env, 'KV_REST_API_TOKEN'),
    },

    esakv: {
      // Name of the Edge KV namespace created in the ESA console.
      namespace: str(env, 'ESA_KV_NAMESPACE') || 'shortlink',
    },
  };
}
