import assert from 'node:assert/strict';
import test from 'node:test';
import { LinkStore } from '../src/store/index.mjs';
import { createMemoryStore } from '../src/store/memory.mjs';

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

// ---------------------------------------------------------------------------
// write-through cache (distributed KV propagates writes asynchronously)
// ---------------------------------------------------------------------------

/** An adapter that accepts writes but never exposes them: worst-case propagation. */
function blackHoleAdapter() {
  return {
    name: 'blackhole',
    async get() {
      return null;
    },
    async put() {},
    async del() {},
    async incr() {
      return 1;
    },
  };
}

test('LinkStore serves a link this isolate just wrote, before KV propagates', async () => {
  const links = new LinkStore(blackHoleAdapter(), { cacheTtlSec: 300 });

  await links.putLink('fresh01', 'https://example.com/fresh');
  const link = await links.getLink('fresh01');

  assert.equal(link.url, 'https://example.com/fresh');
  assert.equal(link.code, 'fresh01');
  assert.equal(link.expiresAt, 0);
});

test('the write-through cache expires and can be disabled', async () => {
  let clock = 1_700_000_000_000;
  const adapter = blackHoleAdapter();

  const cached = new LinkStore(adapter, { cacheTtlSec: 60, now: () => clock });
  await cached.putLink('cached01', 'https://example.com/cached');
  assert.ok(await cached.getLink('cached01'));

  clock += 61_000;
  assert.equal(await cached.getLink('cached01'), null, 'the cache entry expires');

  const uncached = new LinkStore(adapter, { cacheTtlSec: 0 });
  await uncached.putLink('nocache1', 'https://example.com/none');
  assert.equal(await uncached.getLink('nocache1'), null, 'disabled cache always reads the adapter');
});

test('the write-through cache respects link expiry, capacity and deletion', async () => {
  let clock = 1_700_000_000_000;
  const adapter = blackHoleAdapter();

  const links = new LinkStore(adapter, { cacheTtlSec: 300, cacheMax: 2, now: () => clock });
  await links.putLink('slot0001', 'https://example.com/1');
  await links.putLink('slot0002', 'https://example.com/2');
  await links.putLink('slot0003', 'https://example.com/3');

  assert.equal(links.recent.size, 2, 'the cache is bounded');
  assert.equal(await links.getLink('slot0001'), null, 'the oldest entry was evicted');
  assert.ok(await links.getLink('slot0003'));

  await links.deleteLink('slot0003');
  assert.equal(await links.getLink('slot0003'), null, 'deletion evicts the cache entry');

  // A cached link with its own TTL stops resolving once that TTL passes.
  await links.putLink('short001', 'https://example.com/short', { ttlSec: 30 });
  assert.ok(await links.getLink('short001'));
  clock += 31_000;
  assert.equal(await links.getLink('short001'), null);
});
