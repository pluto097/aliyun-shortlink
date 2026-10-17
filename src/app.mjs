/**
 * Routing and business logic.
 *
 * `createApp()` is the single entry point shared by every platform adapter:
 * the returned `handle(request)` is a plain Web `Request -> Response` function,
 * which is exactly what Cloudflare Pages/Workers give us and what the Aliyun FC
 * adapter converts to and from.
 */

import { generateCode, isReservedCode, isValidCustomCode } from './codes.mjs';
import { readConfig } from './config.mjs';
import {
  hasValidCreateToken,
  html,
  json,
  jsonError,
  preflight,
  rateLimit,
  rateLimitHeaders,
  rateLimited,
  text,
  unauthorized,
  withCors,
} from './http.mjs';
import { createStore } from './store/index.mjs';
import { renderLandingPage, renderNotFoundPage } from './ui.mjs';

const MAX_URL_LENGTH = 8192;
const MAX_BODY_LENGTH = 16 * 1024;
const CREATE_ATTEMPTS = 5;
const CODE_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Build an app instance. Platform entries create this once per isolate /
 * instance and reuse it, so the store (and its counters) stay warm.
 *
 * @param {Record<string, unknown>} env
 * @param {{store?: object, config?: object, now?: () => number}} [overrides]
 */
export async function createApp(env = {}, overrides = {}) {
  const config = overrides.config ?? readConfig(env);
  const store = overrides.store ?? (await createStore(config, env, { now: overrides.now }));

  return {
    config,
    store,
    /** @param {Request} request */
    handle: (request) => handleRequest(request, config, store),
  };
}

/**
 * Handle one request end to end.
 * @param {Request} request
 * @param {ReturnType<typeof readConfig>} config
 * @param {{getLink: Function, putLink: Function, resolveDedup: Function, rememberDedup: Function, incr: Function}} store
 */
async function handleRequest(request, config, store) {
  let response;
  try {
    response = await dispatch({ request, config, store });
  } catch (error) {
    console.error('[shortlink] unhandled error for', request.method, request.url, error);
    response = jsonError(500, 'internal_error', 'Internal server error.');
  }

  return withCors(request, response, config);
}

async function dispatch(ctx) {
  const { request, config, store } = ctx;
  const method = request.method.toUpperCase();
  const path = normalizePath(new URL(request.url).pathname);

  if (method === 'OPTIONS') return preflight();

  if (path === '/healthz') {
    if (method === 'GET' || method === 'HEAD') return text('ok');
    return methodNotAllowed(['GET', 'HEAD', 'OPTIONS']);
  }

  if (path === '/') {
    if (method === 'GET' || method === 'HEAD') return html(renderLandingPage(config));
    return methodNotAllowed(['GET', 'HEAD', 'OPTIONS']);
  }

  if (path === '/robots.txt') {
    if (method === 'GET' || method === 'HEAD') return text('User-agent: *\nDisallow: /\n');
    return methodNotAllowed(['GET', 'HEAD', 'OPTIONS']);
  }

  if (path === '/favicon.ico') {
    if (method === 'GET' || method === 'HEAD') return new Response(null, { status: 204 });
    return methodNotAllowed(['GET', 'HEAD', 'OPTIONS']);
  }

  if (path === '/api/shorten') {
    if (method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);
    return handleCreateJson(ctx);
  }

  if (path === '/short') {
    if (method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);
    return handleCreateLegacy(ctx);
  }

  if (path.startsWith('/api/links/')) {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(['GET', 'HEAD', 'OPTIONS']);
    return handleLinkMeta(ctx, path.slice('/api/links/'.length));
  }

  if (method === 'GET' || method === 'HEAD') return handleRedirect(ctx, path);

  return methodNotAllowed(['GET', 'HEAD', 'OPTIONS']);
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

/** POST /api/shorten — JSON or form input, structured JSON output. */
async function handleCreateJson(ctx) {
  const { request, config, store } = ctx;

  const limit = await rateLimit(store, config, request, 'create');
  if (!limit.ok) return rateLimited(limit);
  if (!hasValidCreateToken(request, config)) return unauthorized();

  const input = await readCreateInput(request, config);
  if (input.error) return input.error;

  return createLink({ ...ctx, url: input.url, code: input.code, limit });
}

/**
 * POST /short — compatibility with cf-shortlink-worker:
 * form field `longUrl` holding the base64 encoded URL, `{Code, ShortUrl}` out.
 */
async function handleCreateLegacy(ctx) {
  const { request, config, store } = ctx;

  const limit = await rateLimit(store, config, request, 'create');
  if (!limit.ok) return legacyFrom(rateLimited(limit), limit);
  if (!hasValidCreateToken(request, config)) return legacyFrom(unauthorized(), limit);

  let form;
  try {
    form = await request.formData();
  } catch {
    return legacyError(400, 'Invalid form-data', limit);
  }

  const encoded = form.get('longUrl');
  if (typeof encoded !== 'string' || !encoded.trim()) return legacyError(400, 'Missing longUrl', limit);
  if (encoded.length > MAX_BODY_LENGTH) return legacyError(413, 'longUrl too large', limit);

  let decoded;
  try {
    decoded = decodeBase64Utf8(encoded.trim());
  } catch {
    return legacyError(400, 'Invalid base64 longUrl', limit);
  }

  const checked = validateUrl(decoded, config);
  if (checked.error) return legacyFrom(checked.error, limit);

  const response = await createLink({ ...ctx, url: checked.url, code: '', limit });
  return legacyFrom(response, limit);
}

/** GET /api/links/:code — metadata for a stored code. */
async function handleLinkMeta(ctx, rawCode) {
  let code;
  try {
    code = decodeURIComponent(rawCode);
  } catch {
    return jsonError(400, 'invalid_code', 'Malformed short code.');
  }

  if (!CODE_SHAPE.test(code)) return jsonError(404, 'not_found', 'Link not found.');

  const link = await ctx.store.getLink(code);
  if (!link) return jsonError(404, 'not_found', 'Link not found.');

  return json({
    ok: true,
    code: link.code,
    url: link.url,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
  });
}

/** GET /:code — the actual redirect. */
async function handleRedirect(ctx, path) {
  const { config, store } = ctx;

  let code;
  try {
    code = decodeURIComponent(path.slice(1));
  } catch {
    return renderNotFound(config, path.slice(1));
  }

  if (!code || !CODE_SHAPE.test(code) || isReservedCode(code)) return renderNotFound(config, code);

  const link = await store.getLink(code);
  if (!link) return renderNotFound(config, code);

  return new Response(null, {
    status: 302,
    headers: {
      location: link.url,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

// ---------------------------------------------------------------------------
// creation
// ---------------------------------------------------------------------------

/**
 * Allocate (or reuse) a code and persist the mapping.
 * @returns {Promise<Response>} primary API response shape
 */
async function createLink({ request, config, store, url, code, limit }) {
  let finalCode = code;
  let deduped = false;

  if (finalCode) {
    if (await store.getLink(finalCode)) {
      return jsonError(409, 'code_taken', 'That short code is already taken.');
    }
  } else if (config.dedupTtlSec > 0) {
    const existing = await store.resolveDedup(url);
    if (existing && (await store.getLink(existing))) {
      finalCode = existing;
      deduped = true;
    }
  }

  if (!finalCode) {
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
      const candidate = generateCode(config.codeLength);
      if (isReservedCode(candidate)) continue;
      if (await store.getLink(candidate)) continue;
      finalCode = candidate;
      break;
    }
    if (!finalCode) {
      return jsonError(503, 'code_unavailable', 'Could not allocate a free short code, please retry.');
    }
  }

  await store.putLink(finalCode, url);

  if (config.dedupTtlSec > 0 && !deduped) {
    await store.rememberDedup(url, finalCode, config.dedupTtlSec);
  }

  return json(
    { ok: true, code: finalCode, shortUrl: `${shortBase(config, request)}/${finalCode}`, deduped },
    201,
    rateLimitHeaders(limit),
  );
}

/** Parse `{url, code}` from a JSON or form encoded create request. */
async function readCreateInput(request, config) {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const raw = await request.text();
    if (raw.length > MAX_BODY_LENGTH) {
      return { error: jsonError(413, 'payload_too_large', 'Request body is too large.') };
    }

    let body;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return { error: jsonError(400, 'invalid_json', 'Request body must be valid JSON.') };
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { error: jsonError(400, 'invalid_json', 'Request body must be a JSON object.') };
    }

    return validateInput(body.url ?? body.longUrl, body.code ?? body.slug, config);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return { error: jsonError(400, 'invalid_form', 'Send a JSON body or form data.') };
  }

  return validateInput(form.get('url') ?? form.get('longUrl'), form.get('code'), config);
}

/** Validate the pair of (target URL, optional custom code). */
function validateInput(urlValue, codeValue, config) {
  const checked = validateUrl(urlValue, config);
  if (checked.error) return checked;

  const code = typeof codeValue === 'string' ? codeValue.trim() : '';
  if (code) {
    if (!isValidCustomCode(code)) {
      return { error: jsonError(400, 'invalid_code', 'Codes are 3-64 characters of A-Z, a-z, 0-9, - or _.') };
    }
    if (isReservedCode(code)) {
      return { error: jsonError(400, 'reserved_code', 'That short code is reserved.') };
    }
  }

  return { url: checked.url, code };
}

/** Validate and normalize a target URL. */
function validateUrl(urlValue, config) {
  const value = typeof urlValue === 'string' ? urlValue.trim() : '';

  if (!value) return { error: jsonError(400, 'missing_url', 'Field "url" is required.') };
  if (value.length > MAX_URL_LENGTH) {
    return { error: jsonError(413, 'url_too_long', `The URL must be at most ${MAX_URL_LENGTH} characters.`) };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: jsonError(400, 'invalid_url', 'The URL must be an absolute http(s) URL.') };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: jsonError(400, 'invalid_url', 'Only http and https URLs are supported.') };
  }
  if (parsed.username || parsed.password) {
    return { error: jsonError(400, 'invalid_url', 'URLs embedding credentials are not allowed.') };
  }
  if (!parsed.hostname) {
    return { error: jsonError(400, 'invalid_url', 'The URL must include a host.') };
  }

  for (const matcher of config.blockHosts) {
    if (matcher.test(parsed.hostname)) {
      return { error: jsonError(403, 'blocked_host', 'This host is blocked by policy.') };
    }
  }

  return { url: parsed.toString() };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Collapse duplicate slashes and drop a trailing slash. */
function normalizePath(pathname) {
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  const trimmed = collapsed.replace(/\/+$/, '');
  return trimmed || '/';
}

/** Base for generated short URLs: BASE_URL when set, else the request origin. */
function shortBase(config, request) {
  if (config.baseUrl) return config.baseUrl;
  return new URL(request.url).origin;
}

function methodNotAllowed(allowed) {
  return jsonError(405, 'method_not_allowed', 'Method not allowed for this route.', {
    allow: allowed.join(', '),
  });
}

function renderNotFound(config, code) {
  return html(renderNotFoundPage(config, code), 404);
}

/** Decode standard or URL-safe base64 into a UTF-8 string. */
function decodeBase64Utf8(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Convert a primary-API response into the legacy `{Code, Message}` shape. */
async function legacyFrom(response, limit) {
  const headers = {};
  for (const [name, value] of response.headers) {
    if (name.startsWith('x-r') || name === 'retry-after') headers[name] = value;
  }
  if (Object.keys(headers).length === 0) Object.assign(headers, rateLimitHeaders(limit));

  if (response.ok) {
    const body = await response.json().catch(() => null);
    return json({ Code: 1, ShortUrl: body?.shortUrl ?? '', Message: '' }, 200, headers);
  }

  const body = await response.json().catch(() => null);
  return json({ Code: 0, Message: body?.error?.message ?? 'Request failed' }, response.status, headers);
}

function legacyError(status, message, limit) {
  return json({ Code: 0, Message: message }, status, rateLimitHeaders(limit));
}
