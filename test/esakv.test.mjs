import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_KEY_LENGTH, createEsaKvStore, encodeKey } from '../src/store/esakv.mjs';
import { LinkStore, resolveStorageKind } from '../src/store/index.mjs';

/** ESA-safe key: only [A-Za-z0-9_-] and within the byte limit. */
function isEsaSafeKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) && Buffer.byteLength(key, 'utf8') <= MAX_KEY_LENGTH;
}

/** Minimal stand-in for the EdgeKV global that ESA injects. */
function fakeRuntime() {
  const data = new Map();
  const calls = [];

  class FakeEdgeKV {
    constructor(config) {
      this.namespace = config.namespace;
      calls.push({ op: 'constructor', namespace: config.namespace });
    }

    async get(key, getOptions) {
      calls.push({ op: 'get', key, getOptions });
      const value = data.get(`${this.namespace}|${key}`);
      return value === undefined ? undefined : value;
    }

    async put(key, value) {
      calls.push({ op: 'put', key, value });
      data.set(`${this.namespace}|${key}`, String(value));
    }

    async delete(key) {
      calls.push({ op: 'delete', key });
      data.delete(`${this.namespace}|${key}`);
    }
  }

  return {
    EdgeKV: FakeEdgeKV,
    calls,
    data,
    physicalKeys: () => [...data.keys()].map((entry) => entry.slice(entry.indexOf('|') + 1)),
  };
}

// ---------------------------------------------------------------------------
// key encoding
// ---------------------------------------------------------------------------

test('encodeKey keeps safe characters and escapes the rest', () => {
  assert.equal(encodeKey('k/AbC123'), 'k_2fAbC123');
  assert.equal(encodeKey('203.0.113.9'), '203_2e0_2e113_2e9');
  assert.equal(encodeKey('a:b'), 'a_3ab');
  assert.equal(encodeKey('a_b'), 'a_5fb', 'the escape character itself is escaped');
  assert.equal(encodeKey('plain-code_42'), 'plain-code_5f42');
});

test('encodeKey is injective and always ESA-safe', () => {
  // Every case below must map to a distinct key: a collision would silently
  // merge two different links.
  const samples = [
    'k/abc',
    'k-abc',
    'k_abc',
    'k_2fabc',
    'k/abc/',
    'd/\"',
    'r/create/1/203.0.113.9',
    'r/create/1/203_2e0_2e113_2e9',
    '中文/路径',
    'k/Л',
    'Л',
  ];

  const encoded = samples.map((sample) => encodeKey(sample));
  assert.equal(new Set(encoded).size, samples.length, `collision among ${JSON.stringify(encoded)}`);

  for (const key of encoded) {
    assert.ok(isEsaSafeKey(key), `key ${key} is not ESA-safe`);
  }
});

test('encodeKey escapes multi-byte characters byte by byte', () => {
  // "你" is E4 BD A0 in UTF-8.
  assert.equal(encodeKey('你'), '_e4_bd_a0');
});

// ---------------------------------------------------------------------------
// adapter behaviour
// ---------------------------------------------------------------------------

test('esakv requires a namespace and the EdgeKV runtime', (t) => {
  const runtime = fakeRuntime();
  t.after(() => { delete globalThis.EdgeKV; });

  delete globalThis.EdgeKV;
  assert.throws(() => createEsaKvStore({ namespace: '' }), /ESA_KV_NAMESPACE/);
  assert.throws(() => createEsaKvStore({ namespace: 'shortlink' }), /only runs inside an Aliyun ESA edge function/);

  globalThis.EdgeKV = runtime.EdgeKV;
  const store = createEsaKvStore({ namespace: 'shortlink' });
  assert.equal(store.name, 'esakv');
  assert.deepEqual(runtime.calls[0], { op: 'constructor', namespace: 'shortlink' });
});

test('esakv get/put/del round trip through the EdgeKV API', async (t) => {
  const runtime = fakeRuntime();
  globalThis.EdgeKV = runtime.EdgeKV;
  t.after(() => { delete globalThis.EdgeKV; });

  const store = createEsaKvStore({ namespace: 'links' });

  assert.equal(await store.get('k/missing'), null, 'missing keys are undefined in ESA, null here');

  await store.put('k/AbC1234', 'http://example.com');
  const putCall = runtime.calls.find((call) => call.op === 'put');
  assert.equal(putCall.key, 'k_2fAbC1234', 'physical key is encoded');

  assert.equal(await store.get('k/AbC1234'), 'http://example.com');
  const getCall = runtime.calls.find((call) => call.op === 'get');
  assert.deepEqual(getCall.getOptions, { type: 'text' }, 'GET asks for text');

  await store.del('k/AbC1234');
  assert.equal(await store.get('k/AbC1234'), null);
  assert.ok(runtime.physicalKeys().every(isEsaSafeKey));
});

test('esakv counters carry their own expiry because ESA KV has no TTL', async (t) => {
  const runtime = fakeRuntime();
  globalThis.EdgeKV = runtime.EdgeKV;
  t.after(() => { delete globalThis.EdgeKV; });

  const store = createEsaKvStore({ namespace: 'links' });
  const nowSec = Math.floor(Date.now() / 1000);

  assert.equal(await store.incr('r/create/1/ip', 60), 1);
  const [firstCount, firstExpiry] = (await store.get('r/create/1/ip')).split(':');
  assert.equal(firstCount, '1');
  assert.ok(Number(firstExpiry) > nowSec, 'expiry is stamped on creation');

  assert.equal(await store.incr('r/create/1/ip', 60), 2);
  assert.equal((await store.get('r/create/1/ip')).split(':')[0], '2');
  assert.equal(
    (await store.get('r/create/1/ip')).split(':')[1],
    firstExpiry,
    'incrementing does not extend the window',
  );

  // Simulate a leftover counter from a previous window.
  await store.put('r/create/2/ip', `9:${nowSec - 10}`);
  assert.equal(await store.incr('r/create/2/ip', 60), 1, 'stale counters restart');
});

test('esakv falls back to a hash for pathologically long keys', async (t) => {
  const runtime = fakeRuntime();
  globalThis.EdgeKV = runtime.EdgeKV;
  t.after(() => { delete globalThis.EdgeKV; });

  const store = createEsaKvStore({ namespace: 'links' });
  const longKey = `k/${'a'.repeat(600)}`;

  await store.put(longKey, 'value');
  const [physical] = runtime.physicalKeys();
  assert.match(physical, /^h_[0-9a-f]{64}$/, 'falls back to a sha256 key');
  assert.equal(await store.get(longKey), 'value', 'and stays readable');
});

test('LinkStore works on top of the esakv adapter', async (t) => {
  const runtime = fakeRuntime();
  globalThis.EdgeKV = runtime.EdgeKV;
  t.after(() => { delete globalThis.EdgeKV; });

  const links = new LinkStore(createEsaKvStore({ namespace: 'links' }), { cacheTtlSec: 0 });

  await links.putLink('esa1234', 'https://example.com/esa');
  const link = await links.getLink('esa1234');
  assert.equal(link.url, 'https://example.com/esa');
  assert.equal(link.code, 'esa1234');

  assert.ok(runtime.physicalKeys().every(isEsaSafeKey));
  assert.ok(runtime.physicalKeys().some((key) => key.startsWith('k_2f')), 'link key is prefixed with k_2f');
});

test('storage auto-detection prefers esakv when the runtime provides EdgeKV', (t) => {
  const base = { storage: 'auto', oss: {}, upstash: {}, esakv: { namespace: 'shortlink' } };
  t.after(() => { delete globalThis.EdgeKV; });

  delete globalThis.EdgeKV;
  assert.equal(resolveStorageKind(base, {}), 'memory');

  globalThis.EdgeKV = class {};
  assert.equal(resolveStorageKind(base, {}), 'esakv');
  assert.equal(resolveStorageKind({ ...base, storage: 'memory' }, {}), 'memory', 'explicit STORAGE wins');
});
