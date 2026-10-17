import assert from 'node:assert/strict';
import test from 'node:test';
import { createCfkvStore } from '../src/store/cfkv.mjs';
import { LinkStore, resolveStorageKind } from '../src/store/index.mjs';
import { createMemoryStore } from '../src/store/memory.mjs';

/** A minimal in-memory stand-in for a Cloudflare KV namespace. */
function fakeKvNamespace() {
  const data = new Map();
  const puts = [];

  return {
    data,
    puts,
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async put(key, value, options) {
      data.set(key, value);
      puts.push({ key, value, options });
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

test('memory adapter stores, overwrites and deletes', async () => {
  const store = createMemoryStore();

  await store.put('k/a', 'one');
  assert.equal(await store.get('k/a'), 'one');
  assert.equal(await store.get('k/absent'), null);

  await store.put('k/a', 'two');
  assert.equal(await store.get('k/a'), 'two');

  await store.del('k/a');
  assert.equal(await store.get('k/a'), null);
});

test('memory adapter expires entries and keeps counters', async () => {
  let clock = 1_000_000;
  const store = createMemoryStore({ now: () => clock });

  await store.put('k/short', 'v', { ttlSec: 10 });
  assert.equal(await store.get('k/short'), 'v');

  clock += 10_001;
  assert.equal(await store.get('k/short'), null);

  assert.equal(await store.incr('r/1', 60), 1);
  assert.equal(await store.incr('r/1', 60), 2);
  assert.equal(await store.get('r/1'), '2');
});

test('memory adapter evicts the oldest entry at capacity', async () => {
  const store = createMemoryStore({ maxEntries: 2 });

  await store.put('k/1', 'a');
  await store.put('k/2', 'b');
  await store.put('k/3', 'c');

  assert.equal(store.size(), 2);
  assert.equal(await store.get('k/1'), null);
  assert.equal(await store.get('k/3'), 'c');
});

test('LinkStore round trips a link with metadata', async () => {
  let clock = 1_700_000_000_000;
  const links = new LinkStore(createMemoryStore({ now: () => clock }), { now: () => clock });

  await links.putLink('abc1234', 'https://example.com/x');
  const link = await links.getLink('abc1234');

  assert.deepEqual(link, {
    code: 'abc1234',
    url: 'https://example.com/x',
    createdAt: 1_700_000_000,
    expiresAt: 0,
  });
  assert.equal(await links.getLink('missing'), null);
});

test('LinkStore enforces TTL lazily and cleans up the row', async () => {
  let clock = 1_700_000_000_000;
  const adapter = createMemoryStore({ now: () => clock });
  const links = new LinkStore(adapter, { now: () => clock });

  await links.putLink('ttl1234', 'https://example.com/ttl', { ttlSec: 60 });
  assert.equal((await links.getLink('ttl1234')).url, 'https://example.com/ttl');

  clock += 61_000;
  assert.equal(await links.getLink('ttl1234'), null);
  assert.equal(await adapter.get('k/ttl1234'), null, 'expired row is deleted');
});

test('LinkStore reads legacy plain-text rows written by other shorteners', async () => {
  const adapter = createMemoryStore();
  const links = new LinkStore(adapter);

  await adapter.put('k/legacy1', 'https://legacy.example/path');
  assert.deepEqual(await links.getLink('legacy1'), {
    code: 'legacy1',
    url: 'https://legacy.example/path',
    createdAt: 0,
    expiresAt: 0,
  });
});

test('LinkStore drops corrupt rows instead of throwing', async () => {
  const adapter = createMemoryStore();
  const links = new LinkStore(adapter);

  // JSON without a `u` field is treated as a legacy plain-text URL.
  await adapter.put('k/broken', '{"not":"a link"}');
  assert.equal((await links.getLink('broken')).url, '{"not":"a link"}');

  await adapter.put('k/broken2', '');
  assert.equal(await links.getLink('broken2'), null);
});

test('dedup index maps a URL to its code', async () => {
  const links = new LinkStore(createMemoryStore());

  assert.equal(await links.resolveDedup('https://example.com/d'), null);

  await links.rememberDedup('https://example.com/d', 'CODE123', 600);
  assert.equal(await links.resolveDedup('https://example.com/d'), 'CODE123');
  assert.equal(await links.resolveDedup('https://example.com/other'), null, 'hashed per URL');
});

test('cfkv adapter maps options onto the KV binding', async () => {
  const namespace = fakeKvNamespace();
  const adapter = createCfkvStore(namespace);

  assert.equal(adapter.name, 'cfkv');
  await adapter.put('k/a', 'value');
  assert.deepEqual(namespace.puts.at(-1), { key: 'k/a', value: 'value', options: undefined });

  // KV requires a minimum expirationTtl of 60 seconds.
  await adapter.put('k/b', 'value', { ttlSec: 5 });
  assert.deepEqual(namespace.puts.at(-1).options, { expirationTtl: 60 });

  await adapter.put('k/c', 'value', { ttlSec: 3600 });
  assert.deepEqual(namespace.puts.at(-1).options, { expirationTtl: 3600 });

  assert.equal(await adapter.get('k/a'), 'value');
  assert.equal(await adapter.get('k/absent'), null);

  assert.equal(await adapter.incr('r/1', 60), 1);
  assert.equal(await adapter.incr('r/1', 60), 2);

  await adapter.del('k/a');
  assert.equal(await adapter.get('k/a'), null);
});

test('cfkv adapter rejects a missing binding', () => {
  assert.throws(() => createCfkvStore(undefined), /LINKS/);
  assert.throws(() => createCfkvStore({}), /LINKS/);
});

test('LinkStore works on top of the cfkv adapter', async () => {
  const namespace = fakeKvNamespace();
  const links = new LinkStore(createCfkvStore(namespace));

  await links.putLink('kvc1234', 'https://example.com/kv');
  assert.equal(namespace.data.has('k/kvc1234'), true, 'link is stored under k/');

  const link = await links.getLink('kvc1234');
  assert.equal(link.url, 'https://example.com/kv');
  assert.equal(JSON.parse(namespace.data.get('k/kvc1234')).v, 1);
});

test('storage auto-detection picks the right adapter', () => {
  const base = { storage: 'auto', oss: {}, upstash: {} };

  assert.equal(resolveStorageKind(base, {}), 'memory');
  assert.equal(resolveStorageKind(base, { LINKS: { get() {} } }), 'cfkv');
  assert.equal(
    resolveStorageKind({ ...base, oss: { bucket: 'b', accessKeySecret: 's' } }, {}),
    'oss',
  );
  assert.equal(
    resolveStorageKind({ ...base, upstash: { url: 'https://x.upstash.io' } }, {}),
    'upstash',
  );
  assert.equal(resolveStorageKind({ ...base, storage: 'memory' }, { LINKS: { get() {} } }), 'memory');
  assert.equal(resolveStorageKind({ ...base, storage: 'oss' }, {}), 'oss', 'explicit wins');
});
