import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpstashStore } from '../src/store/upstash.mjs';

const URL = 'https://example.upstash.io';
const TOKEN = 'test-token';

/** Replace global fetch and return scripted `{result}` payloads. */
function stubFetch(results) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method,
      headers: init.headers ?? {},
      command: JSON.parse(String(init.body)),
    });
    const next = results.shift();
    return new Response(JSON.stringify(next ?? { result: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { calls, restore: () => { globalThis.fetch = original; } };
}

function makeStore(overrides = {}) {
  return createUpstashStore({ url: URL, token: TOKEN, ...overrides });
}

test('upstash: get sends GET and parses the result', async (t) => {
  const stub = stubFetch([{ result: 'hello' }, { result: null }]);
  t.after(stub.restore);
  const store = makeStore();

  assert.equal(await store.get('k/a'), 'hello');
  assert.equal(await store.get('k/b'), null);

  const [first] = stub.calls;
  assert.equal(first.url, URL);
  assert.equal(first.method, 'POST');
  assert.equal(first.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(first.command, ['GET', 'k/a']);
});

test('upstash: put uses SET with and without EX', async (t) => {
  const stub = stubFetch([{ result: 'OK' }, { result: 'OK' }]);
  t.after(stub.restore);
  const store = makeStore();

  await store.put('k/a', 'value');
  await store.put('k/b', 'value', { ttlSec: 300 });

  assert.deepEqual(stub.calls[0].command, ['SET', 'k/a', 'value']);
  assert.deepEqual(stub.calls[1].command, ['SET', 'k/b', 'value', 'EX', '300']);
});

test('upstash: del and incr map onto DEL / INCR + EXPIRE', async (t) => {
  const stub = stubFetch([{ result: 1 }, { result: 'OK' }, { result: 2 }, { result: 'OK' }]);
  t.after(stub.restore);
  const store = makeStore();

  assert.equal(await store.incr('r/1', 60), 1, 'first increment sets the TTL');
  assert.equal(await store.incr('r/1', 60), 2, 'later increments reuse it');
  await store.del('k/a');

  assert.deepEqual(stub.calls[0].command, ['INCR', 'r/1']);
  assert.deepEqual(stub.calls[1].command, ['EXPIRE', 'r/1', '60']);
  assert.deepEqual(stub.calls[2].command, ['INCR', 'r/1']);
  assert.deepEqual(stub.calls[3].command, ['DEL', 'k/a']);
});

test('upstash: server errors surface with the command name', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 401 });
  t.after(() => { globalThis.fetch = original; });

  await assert.rejects(() => makeStore().get('k/a'), /Upstash command GET failed \(401\): WRONGPASS/);
});

test('upstash: non-JSON responses and missing config are rejected', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
  t.after(() => { globalThis.fetch = original; });

  await assert.rejects(() => makeStore().get('k/a'), /non-JSON response \(502\)/);

  assert.throws(() => createUpstashStore({}), /UPSTASH_REDIS_REST_URL/);
  assert.throws(() => createUpstashStore({ url: URL }), /UPSTASH_REDIS_REST_TOKEN/);
});
