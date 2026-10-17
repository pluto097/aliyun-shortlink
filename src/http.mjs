/**
 * Platform-neutral HTTP helpers: responses, CORS, client IP, rate limiting and
 * create-token verification. Everything here works on the Web `Request` /
 * `Response` primitives shared by Cloudflare and Node.js (>= 18) alike.
 */

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function buildHeaders(base, extra) {
  const headers = new Headers(base);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null) continue;
      headers.set(key, String(value));
    }
  }
  return headers;
}

/**
 * JSON response (never cached: short links and codes must stay fresh).
 * @param {unknown} payload
 * @param {number} [status]
 * @param {Record<string, string>} [extra]
 */
export function json(payload, status = 200, extra) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: buildHeaders({ ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra),
  });
}

/**
 * Plain-text response.
 * @param {string} body
 * @param {number} [status]
 * @param {Record<string, string>} [extra]
 */
export function text(body, status = 200, extra) {
  return new Response(body, {
    status,
    headers: buildHeaders({ ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, extra),
  });
}

/**
 * HTML response.
 * @param {string} body
 * @param {number} [status]
 * @param {Record<string, string>} [extra]
 */
export function html(body, status = 200, extra) {
  return new Response(body, {
    status,
    headers: buildHeaders({ ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, extra),
  });
}

/**
 * Structured error body, so clients never have to parse prose.
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, string>} [extra]
 */
export function jsonError(status, code, message, extra) {
  return json({ ok: false, error: { code, message } }, status, extra);
}

/** Rate limit metadata, emitted with both new and cf-shortlink-worker style names. */
export function rateLimitHeaders(limit) {
  if (!limit || !(limit.limit > 0)) return {};
  return {
    'x-ratelimit-limit': String(limit.limit),
    'x-ratelimit-remaining': String(limit.remaining),
    'x-ratelimit-reset': String(limit.resetIn),
    'x-rl-remaining': String(limit.remaining),
    'x-rl-reset-in': String(limit.resetIn),
  };
}

/**
 * 429 response that tells the caller when to come back.
 * @param {{limit:number,remaining:number,resetIn:number}} limit
 */
export function rateLimited(limit) {
  return jsonError(429, 'rate_limited', 'Too many requests, please slow down and retry later.', {
    ...rateLimitHeaders(limit),
    'retry-after': String(limit.resetIn),
  });
}

/** 401 response for a missing or wrong create token. */
export function unauthorized() {
  return jsonError(401, 'unauthorized', 'A valid create token is required.', {
    'www-authenticate': 'Bearer realm="shortlink"',
  });
}

/**
 * Best-effort client IP. Cloudflare sets `cf-connecting-ip`; Aliyun FC forwards
 * `x-forwarded-for`; `x-real-ip` covers the remaining proxies.
 * @param {Request} request
 * @returns {string}
 */
export function clientIp(request) {
  const headers = request.headers;
  const candidates = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'x-fc-client-ip'];

  for (const name of candidates) {
    const value = headers.get(name);
    if (!value) continue;
    const first = value.split(',')[0].trim();
    if (first) return first;
  }

  return '0.0.0.0';
}

/**
 * Attach CORS headers according to CORS_MODE.
 * Returns a new Response because response headers of a constructed Response
 * cannot always be mutated in place.
 * @param {Request} request
 * @param {Response} response
 * @param {{corsMode: string, corsOrigins: string[]}} config
 */
export function withCors(request, response, config) {
  if (!config || config.corsMode === 'off') return response;

  const allowHeaders = request.headers.get('access-control-request-headers')?.trim()
    || 'Content-Type, Authorization, X-Admin-Token';
  const headers = new Headers(response.headers);

  if (config.corsMode === 'open') {
    headers.set('access-control-allow-origin', '*');
    headers.set('access-control-allow-methods', 'GET, POST, HEAD, OPTIONS');
    headers.set('access-control-allow-headers', allowHeaders);
    headers.set('access-control-max-age', '86400');
  } else {
    const origin = request.headers.get('origin');
    if (!origin || !config.corsOrigins.includes(origin)) return response;
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', 'GET, POST, HEAD, OPTIONS');
    headers.set('access-control-allow-headers', allowHeaders);
    headers.set('access-control-max-age', '86400');
    const vary = headers.get('vary');
    if (!vary) headers.set('vary', 'Origin');
    else if (!/\borigin\b/i.test(vary)) headers.set('vary', `${vary}, Origin`);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * CORS preflight response. The routing pipeline applies CORS headers to every
 * response (including this one), so the preflight body stays header-free.
 */
export function preflight() {
  return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS } });
}

/**
 * Constant-time-ish string comparison; avoids early-exit leaks on equal-length
 * inputs. Also used to compare the `ACCESS_KEY` path segment.
 * @param {unknown} a
 * @param {unknown} b
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify CREATE_TOKEN when the deployment requires one.
 * @param {Request} request
 * @param {{createToken: string}} config
 */
export function hasValidCreateToken(request, config) {
  if (!config || !config.createToken) return true;

  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  const explicit = (request.headers.get('x-admin-token') || '').trim();

  return safeEqual(bearer, config.createToken) || safeEqual(explicit, config.createToken);
}

/**
 * Fixed-window rate limiting, counted in the configured store so it survives
 * isolate recycling and works identically on both platforms.
 *
 * Fails open: a broken counter must never take the redirect path down.
 * @param {{incr: (key: string, ttlSec: number) => Promise<number>}} store
 * @param {{rlMaxReq: number, rlWindowSec: number}} config
 * @param {Request} request
 * @param {string} [scope]
 */
export async function rateLimit(store, config, request, scope = 'create') {
  const max = config?.rlMaxReq ?? 0;
  if (!(max > 0)) {
    return { ok: true, limit: 0, remaining: -1, resetIn: 0 };
  }

  const windowSec = config.rlWindowSec;
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSec);
  const resetIn = Math.max(1, (bucket + 1) * windowSec - now);
  const key = `r/${scope}/${bucket}/${encodeURIComponent(clientIp(request))}`;

  let count;
  try {
    count = await store.incr(key, resetIn + 1);
  } catch (error) {
    console.warn('[shortlink] rate limit counter unavailable, failing open:', error?.message || error);
    return { ok: true, limit: max, remaining: max, resetIn };
  }

  return {
    ok: count <= max,
    limit: max,
    remaining: Math.max(0, max - count),
    resetIn,
  };
}
