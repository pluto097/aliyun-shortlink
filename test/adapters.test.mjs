import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eventToRequest, handleEvent, responseToEvent } from '../fc/event.mjs';
import { makeApp } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** Build an FC 3.0 HTTP trigger event (payload version v1). */
function fcEvent(method, requestPath, options = {}) {
  return {
    version: 'v1',
    rawPath: options.rawPath ?? requestPath,
    body: options.body ?? '',
    isBase64Encoded: options.isBase64Encoded ?? false,
    headers: options.headers ?? { 'Content-Type': 'application/json' },
    queryParameters: options.queryParameters ?? {},
    requestContext: {
      domainName: 'svc.cn-hangzhou.fcapp.run',
      http: {
        method,
        path: options.decodedPath ?? requestPath,
        protocol: 'HTTP/1.1',
        sourceIp: options.sourceIp ?? '203.0.113.9',
        userAgent: 'fc-test',
      },
      requestId: 'req-test-1',
    },
  };
}

// ---------------------------------------------------------------------------
// FC event <-> Request/Response
// ---------------------------------------------------------------------------

test('eventToRequest maps the FC v1 event onto a Web Request', () => {
  const request = eventToRequest(
    fcEvent('POST', '/api/shorten', {
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json', 'X-Custom': 'yes' },
      sourceIp: '198.51.100.7',
      queryParameters: { utm: 'abc' },
      decodedPath: '/api/shorten',
    }),
  );

  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://svc.cn-hangzhou.fcapp.run/api/shorten?utm=abc');
  assert.equal(request.headers.get('content-type'), 'application/json');
  assert.equal(request.headers.get('x-custom'), 'yes');
  assert.equal(request.headers.get('x-forwarded-for'), '198.51.100.7', 'sourceIp is exposed as the client IP');
});

test('eventToRequest decodes the body and drops FC content-length', async () => {
  const payload = { url: 'https://example.com/b64' };
  const request = eventToRequest(
    fcEvent('POST', '/api/shorten', {
      body: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
      isBase64Encoded: true,
      headers: { 'Content-Type': 'application/json', 'Content-Length': '999' },
    }),
  );

  assert.notEqual(request.headers.get('content-length'), '999', 'stale length is dropped');
  assert.deepEqual(await request.json(), payload);
});

test('eventToRequest has no body for GET/HEAD and decodes the raw path', () => {
  const get = eventToRequest(fcEvent('GET', '/abc1234', { body: 'ignored', decodedPath: undefined }));
  assert.equal(get.body, null);
  assert.equal(new URL(get.url).pathname, '/abc1234');

  const encoded = eventToRequest(
    fcEvent('GET', '/%E4%BD%A0', { rawPath: '/%E4%BD%A0', decodedPath: undefined }),
  );
  assert.equal(new URL(encoded.url).pathname, '/%E4%BD%A0');
});

test('responseToEvent keeps text responses as text', async () => {
  const app = await makeApp({ RL_MAX_REQ: '0' });
  const response = await app.handle(new Request('https://s.example.com/healthz'));
  const out = await responseToEvent(response);

  assert.equal(out.statusCode, 200);
  assert.equal(out.isBase64Encoded, false);
  assert.equal(out.body, 'ok');
  assert.equal(out.headers['content-type'], 'text/plain; charset=utf-8');
});

test('responseToEvent base64 encodes binary bodies and keeps empty redirects empty', async () => {
  const binary = await responseToEvent(new Response(new Uint8Array([1, 2, 3]), {
    headers: { 'content-type': 'application/octet-stream' },
  }));
  assert.equal(binary.isBase64Encoded, true);
  assert.equal(Buffer.from(binary.body, 'base64').toString('hex'), '010203');

  const redirect = await responseToEvent(new Response(null, {
    status: 302,
    headers: { location: 'https://example.com' },
  }));
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.body, '');
  assert.equal(redirect.isBase64Encoded, false);
  assert.equal(redirect.headers.location, 'https://example.com');
});

// ---------------------------------------------------------------------------
// FC handler end to end
// ---------------------------------------------------------------------------

test('handleEvent creates and follows a short link through the FC contract', async () => {
  const app = await makeApp({ BASE_URL: 'https://sho.rt', RL_MAX_REQ: '0' });

  const created = await handleEvent(
    fcEvent('POST', '/api/shorten', { body: JSON.stringify({ url: 'https://example.com/fc' }) }),
    app,
  );
  assert.equal(created.statusCode, 201);

  const body = JSON.parse(created.body);
  assert.equal(body.shortUrl, `https://sho.rt/${body.code}`);

  const redirect = await handleEvent(fcEvent('GET', `/${body.code}`), app);
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, 'https://example.com/fc');

  const missing = await handleEvent(fcEvent('GET', '/nosuch1'), app);
  assert.equal(missing.statusCode, 404);
  assert.ok(missing.body.includes('404'));
});

test('the FC CommonJS entry exports a handler', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'fc', 'index.js')).href);
  assert.equal(typeof mod.handler, 'function');
});

// ---------------------------------------------------------------------------
// Cloudflare entries
// ---------------------------------------------------------------------------

test('Pages onRequest forwards the request and env as a Response', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'functions', '[[path]].js')).href);
  assert.equal(typeof module.onRequest, 'function');

  const env = { STORAGE: 'memory', RL_MAX_REQ: '0' };
  const context = {
    request: new Request('https://s.example.com/healthz'),
    env,
    params: { path: ['healthz'] },
    data: {},
    next: async () => new Response('next'),
    functionPath: '/healthz',
  };

  const response = await module.onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');

  const landing = await module.onRequest({ ...context, request: new Request('https://s.example.com/') });
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get('content-type'), /text\/html/);
});

test('the Workers entry exposes fetch', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'worker.mjs')).href);

  const response = await module.default.fetch(new Request('https://s.example.com/healthz'), {
    STORAGE: 'memory',
    RL_MAX_REQ: '0',
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
});

// ---------------------------------------------------------------------------
// Node HTTP server (FC Web 函数 / local dev)
// ---------------------------------------------------------------------------

test('the Node server serves the full flow over real HTTP', async (t) => {
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'fc', 'server.mjs')).href);
  const server = await startServer({
    port: 0,
    env: { STORAGE: 'memory', RL_MAX_REQ: '0', BASE_URL: 'http://127.0.0.1' },
  });
  t.after(async () => { await server.close(); });

  assert.ok(server.port > 0);

  const created = await fetch(`${server.url}/api/shorten`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/http' }),
  });
  assert.equal(created.status, 201);
  const body = await created.json();

  const redirect = await fetch(`${server.url}/${body.code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/http');

  const head = await fetch(`${server.url}/${body.code}`, { method: 'HEAD', redirect: 'manual' });
  assert.equal(head.status, 302);
  assert.equal(head.headers.get('location'), 'https://example.com/http');

  const landing = await fetch(`${server.url}/`);
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /<html/);

  const preflight = await fetch(`${server.url}/api/shorten`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});
