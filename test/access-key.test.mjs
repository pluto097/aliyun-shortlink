import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.mjs';
import { ORIGIN, call, createLink, makeApp, postJson } from '../test-support/helpers.mjs';

const KEY = 'key123456';

/** Request a path inside the access-key namespace. */
function keyed(app, path = '/', init) {
  return call(app, `/${KEY}${path}`, init);
}

/** POST JSON to the create endpoint inside the access-key namespace. */
function postKeyed(app, payload, headers = {}) {
  return keyed(app, '/api/shorten', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// backwards compatibility
// ---------------------------------------------------------------------------

test('without ACCESS_KEY everything stays public', async () => {
  const app = await makeApp();

  assert.equal((await call(app, '/')).status, 200);
  assert.equal((await postJson(app, { url: 'https://example.com/open' })).status, 201);

  const { body } = await createLink(app, { url: 'https://example.com/open2' });
  const redirect = await call(app, `/${body.code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
});

// ---------------------------------------------------------------------------
// private mode: what is hidden
// ---------------------------------------------------------------------------

test('the root and the unprefixed API return 404 without leaking the key', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });

  const root = await call(app, '/');
  assert.equal(root.status, 404);
  const rootBody = await root.text();
  assert.ok(!rootBody.includes(KEY), 'the 404 page must not contain the access key');
  assert.ok(!rootBody.includes('返回首页'), 'the "back home" link is omitted in private mode');

  for (const [path, init] of [
    ['/api/shorten', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }],
    ['/short', { method: 'POST', body: new FormData() }],
    ['/api/links/anything', {}],
    ['/api', {}],
  ]) {
    const response = await call(app, path, init);
    assert.equal(response.status, 404, `expected 404 for ${path}`);
    assert.match(response.headers.get('content-type'), /application\/json/, `${path} answers JSON`);
    assert.equal((await response.json()).error.code, 'not_found');
  }
});

test('a wrong, longer or differently cased prefix is rejected', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });

  for (const path of ['/wrongkey/', `/${KEY}abc/`, '/Key123456/', `/${KEY}-extra/`, '/key12345/']) {
    const response = await call(app, path);
    assert.equal(response.status, 404, `expected 404 for ${path}`);
  }
});

// ---------------------------------------------------------------------------
// private mode: what works
// ---------------------------------------------------------------------------

test('the page is served under the prefix, with or without a trailing slash', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });

  for (const path of [`/${KEY}`, `/${KEY}/`, `/${KEY}//`]) {
    const response = await call(app, path);
    assert.equal(response.status, 200, `expected 200 for ${path}`);
    assert.match(response.headers.get('content-type'), /text\/html/);
  }

  const html = await (await keyed(app)).text();
  assert.ok(html.includes(`const BASE_PATH = "/${KEY}"`), 'the page knows its mount point');
  assert.ok(html.includes("fetch(BASE_PATH + '/short'"), 'the form calls the API through the prefix');
  assert.equal((await keyed(app, '/', { method: 'HEAD' })).status, 200);
});

test('the create API works under the prefix and still returns public short links', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });

  const response = await postKeyed(app, { url: 'https://example.com/private' });
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(!body.shortUrl.includes(KEY), 'short links stay public');
  assert.equal(body.shortUrl, `${ORIGIN}/${body.code}`);

  // The redirect is public in both shapes.
  const plain = await call(app, `/${body.code}`, { redirect: 'manual' });
  assert.equal(plain.status, 302);
  assert.equal(plain.headers.get('location'), 'https://example.com/private');

  const prefixed = await keyed(app, `/${body.code}`, { redirect: 'manual' });
  assert.equal(prefixed.status, 302);
  assert.equal(prefixed.headers.get('location'), 'https://example.com/private');
});

test('custom codes and metadata work under the prefix', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });

  const created = await postKeyed(app, { url: 'https://example.com/meta', code: 'privcode' });
  assert.equal(created.status, 201);

  const meta = await keyed(app, '/api/links/privcode');
  assert.equal(meta.status, 200);
  assert.equal((await meta.json()).url, 'https://example.com/meta');

  assert.equal((await keyed(app, '/api/links/nosuch1')).status, 404);
});

test('the legacy /short endpoint works under the prefix', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });
  const encoded = Buffer.from('https://example.com/legacy-private', 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const form = new FormData();
  form.set('longUrl', encoded);
  const response = await keyed(app, '/short', { method: 'POST', body: form });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.Code, 1);
  assert.ok(!body.ShortUrl.includes(KEY));
});

// ---------------------------------------------------------------------------
// public endpoints that stay reachable
// ---------------------------------------------------------------------------

test('healthz and CORS preflight stay public', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });

  const health = await call(app, '/healthz');
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'ok');

  // Also reachable inside the prefix, harmlessly.
  assert.equal((await keyed(app, '/healthz')).status, 200);

  const preflight = await keyed(app, '/api/shorten', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});

// ---------------------------------------------------------------------------
// interactions with the rest of the feature set
// ---------------------------------------------------------------------------

test('a custom code equal to the access key is rejected', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });

  const response = await postKeyed(app, { url: 'https://example.com/x', code: KEY });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'reserved_code');
});

test('ACCESS_KEY and CREATE_TOKEN can be combined', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY, CREATE_TOKEN: 'sesame' });

  const page = await (await keyed(app)).text();
  assert.ok(page.includes('id="tokenInput"'), 'the token field is still offered');

  const noToken = await postKeyed(app, { url: 'https://example.com/both' });
  assert.equal(noToken.status, 401);

  const withToken = await postKeyed(app, { url: 'https://example.com/both' }, { authorization: 'Bearer sesame' });
  assert.equal(withToken.status, 201);
});

test('layout names that used to be public now 404 at the root', async () => {
  const app = await makeApp({ ACCESS_KEY: KEY });

  for (const path of ['/robots.txt', '/favicon.ico']) {
    assert.equal((await call(app, path)).status, 404, `${path} at the root`);
  }
  assert.equal((await keyed(app, '/robots.txt')).status, 200);
});

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

test('ACCESS_KEY is validated at startup', () => {
  assert.equal(readConfig({}).accessKey, '');
  assert.equal(readConfig({ ACCESS_KEY: 'abcd' }).accessKey, 'abcd');
  assert.equal(readConfig({ ACCESS_KEY: 'key123456' }).accessKey, 'key123456');
  assert.equal(readConfig({ ACCESS_KEY: 'abc-123_XYZ' }).accessKey, 'abc-123_XYZ');
  assert.equal(readConfig({ ACCESS_KEY: '  key123456  ' }).accessKey, 'key123456', 'trimmed');

  for (const bad of ['bad key!', 'has/slash', 'has.dot', 'a'.repeat(65), 'key@home']) {
    assert.throws(() => readConfig({ ACCESS_KEY: bad }), /ACCESS_KEY must be 4-64 characters/, bad);
  }
});
