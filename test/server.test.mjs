import assert from 'node:assert/strict';
import test from 'node:test';
import { startServer } from '../scripts/serve.mjs';

// ---------------------------------------------------------------------------
// Local preview server (scripts/serve.mjs) over real HTTP
// ---------------------------------------------------------------------------

test('the local server serves the full flow over real HTTP', async (t) => {
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

test('the local server defaults to the in-memory store', async (t) => {
  const server = await startServer({ port: 0, env: {} });
  t.after(async () => { await server.close(); });

  assert.equal(server.app.store.name, 'memory');
});
