import assert from 'node:assert/strict';
import test from 'node:test';
import { ALPHABET, generateCode, isReservedCode, isValidCustomCode } from '../src/codes.mjs';
import { readConfig } from '../src/config.mjs';
import { ORIGIN, call, createLink, makeApp, postJson } from './helpers.mjs';

// ---------------------------------------------------------------------------
// codes + config
// ---------------------------------------------------------------------------

test('generateCode uses the unambiguous alphabet and the requested length', () => {
  for (const length of [4, 7, 12, 32]) {
    const code = generateCode(length);
    assert.equal(code.length, length);
    for (const char of code) assert.ok(ALPHABET.includes(char), `unexpected char ${char}`);
    assert.ok(!/[0O1lI]/.test(code), 'ambiguous characters must not be generated');
  }
});

test('generateCode is not trivially predictable', () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateCode(7)));
  assert.ok(codes.size > 195, `expected near-unique codes, got ${codes.size}`);
});

test('custom code validation and reserved words', () => {
  assert.equal(isValidCustomCode('abc'), true);
  assert.equal(isValidCustomCode('a_b-C9'), true);
  assert.equal(isValidCustomCode('ab'), false, 'too short');
  assert.equal(isValidCustomCode('a'.repeat(65)), false, 'too long');
  assert.equal(isValidCustomCode('has space'), false);
  assert.equal(isReservedCode('API'), true, 'reserved matching is case insensitive');
  assert.equal(isReservedCode('healthz'), true);
  assert.equal(isReservedCode('randomcode'), false);
});

test('readConfig clamps values and applies defaults', () => {
  const config = readConfig({
    CODE_LENGTH: '999',
    RL_MAX_REQ: '-5',
    CORS_MODE: 'nonsense',
    BLOCK_HOSTS: 'evil\\.com,[invalid',
    LINKS: { get() {} },
  });

  assert.equal(config.codeLength, 32, 'clamped to the upper bound');
  assert.equal(config.rlMaxReq, 0, 'negative becomes disabled');
  assert.equal(config.corsMode, 'open', 'invalid mode falls back to open');
  assert.equal(config.blockHosts.length, 1, 'invalid regex is skipped');
  assert.equal(config.storage, 'auto');
  assert.equal(readConfig({}).pageTitle, 'ShortLink');
});

// ---------------------------------------------------------------------------
// redirects & pages
// ---------------------------------------------------------------------------

test('GET / renders the landing page with the configured title', async () => {
  const app = await makeApp({ PAGE_TITLE: 'My Links', PAGE_ICON: '🚀', PAGE_DESC: 'fast' });
  const response = await call(app, '/');

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const body = await response.text();
  assert.ok(body.includes('My Links'));
  assert.ok(body.includes('🚀'));
  assert.ok(body.includes('fast'));
  assert.ok(body.trimEnd().endsWith('</html>'));
});

test('the landing page escapes user supplied configuration', async () => {
  const app = await makeApp({ PAGE_TITLE: '<script>alert(1)</script>' });
  const body = await (await call(app, '/')).text();

  assert.ok(!body.includes('<script>alert(1)</script>'), 'title must be escaped');
  assert.ok(body.includes('&lt;script&gt;'));
});

test('an existing code redirects with location and no-store', async () => {
  const app = await makeApp({ BASE_URL: 'https://sho.rt' });
  const { body } = await createLink(app, { url: 'https://example.com/a?b=1' });

  const response = await call(app, `/${body.code}`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.com/a?b=1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.body, null, 'redirect has no body');
});

test('HEAD on a code returns the redirect headers without a body', async () => {
  const app = await makeApp();
  const { body } = await createLink(app, { url: 'https://example.com/head' });

  const response = await call(app, `/${body.code}`, { method: 'HEAD', redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.com/head');
  assert.equal(response.body, null);
});

test('unknown and malformed codes render the 404 page', async () => {
  const app = await makeApp();

  for (const path of ['/missing123', '/%E4%BD%A0%E5%A5%BD', '/a'.repeat(1) + 'b', '/api/links/missing123']) {
    const response = await call(app, path, { redirect: 'manual' });
    assert.equal(response.status, 404, `expected 404 for ${path}`);
  }

  const page = await call(app, '/missing123');
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.ok((await page.text()).includes('404'));
});

test('trailing slashes and duplicate slashes still resolve', async () => {
  const app = await makeApp();
  const { body } = await createLink(app, { url: 'https://example.com/slash' });

  const withSlash = await call(app, `/${body.code}/`, { redirect: 'manual' });
  assert.equal(withSlash.status, 302);
});

test('health, robots and favicon endpoints', async () => {
  const app = await makeApp();

  const health = await call(app, '/healthz');
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');

  const robots = await call(app, '/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Disallow: \//);

  const favicon = await call(app, '/favicon.ico');
  assert.equal(favicon.status, 204);
});

// ---------------------------------------------------------------------------
// create API
// ---------------------------------------------------------------------------

test('POST /api/shorten creates a link and honours BASE_URL', async () => {
  const app = await makeApp({ BASE_URL: 'https://sho.rt/' });
  const response = await postJson(app, { url: 'https://example.com/hello' });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.deduped, false);
  assert.match(body.code, /^[A-Za-z0-9_-]{7}$/);
  assert.equal(body.shortUrl, `https://sho.rt/${body.code}`);
});

test('without BASE_URL the request origin is used', async () => {
  const app = await makeApp();
  const { body } = await createLink(app, { url: 'https://example.com/origin' });
  assert.equal(body.shortUrl, `${ORIGIN}/${body.code}`);
});

test('a custom code is honoured and conflicts are rejected', async () => {
  const app = await makeApp();

  const first = await postJson(app, { url: 'https://example.com/one', code: 'mine' });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).code, 'mine');

  const second = await postJson(app, { url: 'https://example.com/two', code: 'mine' });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, 'code_taken');
});

test('invalid URLs are rejected with structured errors', async () => {
  const app = await makeApp();
  const cases = [
    ['javascript:alert(1)', 400, 'invalid_url'],
    ['ftp://example.com/file', 400, 'invalid_url'],
    ['not-a-url', 400, 'invalid_url'],
    ['https://user:pass@example.com/x', 400, 'invalid_url'],
    ['', 400, 'missing_url'],
    [`https://example.com/${'a'.repeat(9000)}`, 413, 'url_too_long'],
  ];

  for (const [url, status, code] of cases) {
    const response = await postJson(app, { url });
    assert.equal(response.status, status, `status for ${url.slice(0, 30)}`);
    assert.equal((await response.json()).error.code, code);
  }
});

test('malformed JSON and unknown codes are rejected', async () => {
  const app = await makeApp();

  const brokenJson = await call(app, '/api/shorten', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(brokenJson.status, 400);
  assert.equal((await brokenJson.json()).error.code, 'invalid_json');

  const reserved = await postJson(app, { url: 'https://example.com/x', code: 'api' });
  assert.equal(reserved.status, 400);
  assert.equal((await reserved.json()).error.code, 'reserved_code');

  const badCode = await postJson(app, { url: 'https://example.com/x', code: 'a b' });
  assert.equal(badCode.status, 400);
  assert.equal((await badCode.json()).error.code, 'invalid_code');
});

test('form encoded input works on the primary API', async () => {
  const app = await makeApp();
  const form = new FormData();
  form.set('url', 'https://example.com/form');
  form.set('code', 'formcode');

  const response = await call(app, '/api/shorten', { method: 'POST', body: form });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).code, 'formcode');
});

test('BLOCK_HOSTS rejects matching hosts', async () => {
  const app = await makeApp({ BLOCK_HOSTS: 'evil\\.com,spam\\.net' });

  const blocked = await postJson(app, { url: 'https://sub.evil.com/x' });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error.code, 'blocked_host');

  const allowed = await postJson(app, { url: 'https://good.example/x' });
  assert.equal(allowed.status, 201);
});

test('GET /api/links/:code returns metadata', async () => {
  const app = await makeApp();
  await postJson(app, { url: 'https://example.com/meta', code: 'meta1' });

  const response = await call(app, '/api/links/meta1');
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.code, 'meta1');
  assert.equal(body.url, 'https://example.com/meta');
  assert.ok(body.createdAt > 0);
  assert.equal(body.expiresAt, 0);

  const missing = await call(app, '/api/links/nosuch1');
  assert.equal(missing.status, 404);
});

test('CREATE_TOKEN gates the create endpoints', async () => {
  const app = await makeApp({ CREATE_TOKEN: 'sesame' });
  const payload = { url: 'https://example.com/token' };

  const anonymous = await postJson(app, payload);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, 'unauthorized');

  const bearer = await postJson(app, payload, { authorization: 'Bearer sesame' });
  assert.equal(bearer.status, 201);

  const explicit = await postJson(app, { url: 'https://example.com/token2' }, { 'x-admin-token': 'sesame' });
  assert.equal(explicit.status, 201);

  const wrong = await postJson(app, payload, { authorization: 'Bearer wrong' });
  assert.equal(wrong.status, 401);

  // redirects stay public even when creation is gated
  const created = await bearer.json();
  const follow = await call(app, `/${created.code}`, { redirect: 'manual' });
  assert.equal(follow.status, 302);
});

// ---------------------------------------------------------------------------
// rate limiting, dedup, CORS
// ---------------------------------------------------------------------------

test('rate limiting returns 429 with retry metadata', async () => {
  const app = await makeApp({ RL_MAX_REQ: '2', RL_WINDOW_SEC: '60' });
  const make = (ip) =>
    postJson(app, { url: 'https://example.com/ratelimit' }, { 'x-forwarded-for': ip });

  const first = await make('203.0.113.7');
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('x-ratelimit-limit'), '2');
  assert.equal(first.headers.get('x-ratelimit-remaining'), '1');

  const second = await make('203.0.113.7');
  assert.equal(second.status, 201);
  assert.equal(second.headers.get('x-ratelimit-remaining'), '0');

  const third = await make('203.0.113.7');
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) > 0);
  assert.equal((await third.json()).error.code, 'rate_limited');

  // a different client keeps its own budget
  const other = await make('198.51.100.4');
  assert.equal(other.status, 201);
});

test('redirects are never rate limited', async () => {
  const app = await makeApp({ RL_MAX_REQ: '1' });
  const { body } = await createLink(app, { url: 'https://example.com/redirect-free' });

  for (let index = 0; index < 5; index += 1) {
    const response = await call(app, `/${body.code}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
  }
});

test('DEDUP_TTL_SEC reuses the code for the same URL', async () => {
  const app = await makeApp({ DEDUP_TTL_SEC: '600' });
  const url = 'https://example.com/same-target';

  const first = await (await postJson(app, { url })).json();
  const second = await (await postJson(app, { url })).json();

  assert.equal(first.code, second.code);
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);

  const different = await (await postJson(app, { url: 'https://example.com/other' })).json();
  assert.notEqual(different.code, first.code);
});

test('CORS open mode allows any origin', async () => {
  const app = await makeApp({ CORS_MODE: 'open' });

  const preflight = await call(app, '/api/shorten', {
    method: 'OPTIONS',
    headers: { origin: 'https://a.example', 'access-control-request-method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');

  const response = await call(app, '/healthz', { headers: { origin: 'https://a.example' } });
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('CORS off mode sends no CORS headers', async () => {
  const app = await makeApp({ CORS_MODE: 'off' });
  const response = await call(app, '/healthz', { headers: { origin: 'https://a.example' } });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('CORS list mode only echoes allow-listed origins', async () => {
  const app = await makeApp({ CORS_MODE: 'list', CORS_ORIGINS: 'https://ok.example' });

  const allowed = await call(app, '/healthz', { headers: { origin: 'https://ok.example' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://ok.example');
  assert.match(allowed.headers.get('vary') ?? '', /Origin/);

  const denied = await call(app, '/healthz', { headers: { origin: 'https://bad.example' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

// ---------------------------------------------------------------------------
// legacy compatibility
// ---------------------------------------------------------------------------

test('POST /short accepts base64 longUrl and returns the legacy shape', async () => {
  const app = await makeApp({ BASE_URL: 'https://sho.rt' });
  const encoded = Buffer.from('https://example.com/legacy', 'utf8').toString('base64');

  const form = new FormData();
  form.set('longUrl', encoded);
  const response = await call(app, '/short', { method: 'POST', body: form });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.Code, 1);
  assert.match(body.ShortUrl, /^https:\/\/sho\.rt\/[A-Za-z0-9_-]{7}$/);
  assert.equal(body.Message, '');
});

test('POST /short reports legacy shaped errors', async () => {
  const app = await makeApp();

  const missing = new FormData();
  const noField = await call(app, '/short', { method: 'POST', body: missing });
  assert.equal(noField.status, 400);
  assert.equal((await noField.json()).Code, 0);

  const invalid = new FormData();
  invalid.set('longUrl', Buffer.from('ftp://example.com').toString('base64'));
  const badProtocol = await call(app, '/short', { method: 'POST', body: invalid });
  assert.equal(badProtocol.status, 400);
  assert.equal((await badProtocol.json()).Code, 0);

  const badBase64 = new FormData();
  badBase64.set('longUrl', '!!!not-base64!!!');
  const undecodable = await call(app, '/short', { method: 'POST', body: badBase64 });
  assert.equal(undecodable.status, 400);
  assert.equal((await undecodable.json()).Code, 0);
});

test('the legacy endpoint still works when the primary API is gated', async () => {
  const app = await makeApp({ CREATE_TOKEN: 'sesame' });
  const form = new FormData();
  form.set('longUrl', Buffer.from('https://example.com/gated').toString('base64'));

  const denied = await call(app, '/short', { method: 'POST', body: form });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).Code, 0);
});

test('405 is returned for unsupported methods with an Allow header', async () => {
  const app = await makeApp();

  const get = await call(app, '/api/shorten');
  assert.equal(get.status, 405);
  assert.equal((await get.json()).error.code, 'method_not_allowed');
  assert.match(get.headers.get('allow') ?? '', /POST/);

  const del = await call(app, '/healthz', { method: 'DELETE' });
  assert.equal(del.status, 405);
});
