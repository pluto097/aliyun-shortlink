import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { buildEsaBundle, pickEnvFromProcess } from '../scripts/build-esa.mjs';

const ESA_ENV = {
  STORAGE: 'esakv',
  ESA_KV_NAMESPACE: 'shortlink',
  BASE_URL: 'https://sho.rt',
  PAGE_TITLE: 'ESA Links',
  RL_MAX_REQ: '0',
};

/**
 * Install a fake ESA runtime: the EdgeKV global plus the config channel the
 * entry point reads. Returns a cleanup function.
 */
function installRuntime(store, runtimeEnv = ESA_ENV) {
  class FakeEdgeKV {
    constructor(config) {
      this.namespace = config.namespace;
    }

    async get(key) {
      return store.get(`${this.namespace}|${key}`);
    }

    async put(key, value) {
      store.set(`${this.namespace}|${key}`, String(value));
    }

    async delete(key) {
      store.delete(`${this.namespace}|${key}`);
    }
  }

  globalThis.EdgeKV = FakeEdgeKV;
  globalThis.__SHORTLINK_ENV__ = runtimeEnv;

  return () => {
    delete globalThis.EdgeKV;
    delete globalThis.__SHORTLINK_ENV__;
  };
}

/** Import generated code as a real ES module without writing files. */
function importCode(code) {
  return import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`);
}

test('the bundle is a single self-contained ES module', () => {
  const { code, modules, bytes } = buildEsaBundle({ env: ESA_ENV, useProcessEnv: false });

  assert.ok(modules.includes('esa/entry.mjs'), 'entry is bundled');
  assert.ok(modules.includes('src/app.mjs'), 'core is bundled');
  assert.ok(modules.includes('src/store/esakv.mjs'), 'the ESA adapter is bundled');
  assert.equal(modules.at(-1), 'esa/entry.mjs', 'the entry comes last so its default export survives');

  assert.equal(/^\s*import\s/m.test(code), false, 'no import statements remain');
  assert.equal((code.match(/^export\s+default/gm) ?? []).length, 1, 'exactly one default export');
  assert.ok(code.includes('const ESA_BUILD_ENV'), 'config is injected');

  assert.ok(bytes > 0);
  assert.ok(bytes < 4 * 1024 * 1024, `bundle is ${bytes} bytes, must stay under the 4 MB ESA limit`);
});

test('builds even without any configuration', () => {
  const { code, env } = buildEsaBundle({ useProcessEnv: false });
  assert.deepEqual(env, {});
  assert.ok(code.includes('const ESA_BUILD_ENV = {};'));
});

test('build-time environment variables are whitelisted and win over the env file', () => {
  const picked = pickEnvFromProcess({
    STORAGE: 'oss',
    OSS_BUCKET: 'bucket',
    OSS_ACCESS_KEY_ID: 'ak',
    UPSTASH_REDIS_REST_URL: 'https://upstash',
    PATH: '/usr/bin',
    HOME: '/root',
    SOME_UNRELATED: 'nope',
  });

  assert.deepEqual(Object.keys(picked).sort(), [
    'OSS_ACCESS_KEY_ID',
    'OSS_BUCKET',
    'STORAGE',
    'UPSTASH_REDIS_REST_URL',
  ]);

  const { env } = buildEsaBundle({
    env: { STORAGE: 'esakv', BASE_URL: 'https://from-file.example' },
    processEnv: { BASE_URL: 'https://from-build.example', PATH: '/usr/bin' },
    useProcessEnv: true,
  });

  assert.equal(env.BASE_URL, 'https://from-build.example', 'build variables override the file');
  assert.equal(env.STORAGE, 'esakv', 'file values survive when not overridden');
  assert.equal(env.PATH, undefined, 'unrelated variables are not baked in');
});

test('every key in esa/env.example.json can actually be baked in', () => {
  // Guards documentation drift: a variable documented in the template but
  // missing from the bundler whitelist would be silently ignored at build time.
  const template = JSON.parse(fs.readFileSync(new URL('../esa/env.example.json', import.meta.url), 'utf8'));
  const keys = Object.keys(template);
  assert.ok(keys.length >= 15, `expected a full template, got ${keys.length} keys`);

  for (const key of keys) {
    const baked = pickEnvFromProcess({ [key]: 'x' });
    assert.ok(key in baked, `${key} is in esa/env.example.json but not in the bundler whitelist`);
  }
});

test('the generated bundle serves the full flow on a simulated ESA runtime', async (t) => {
  // A tiny adapter stand-in is not used here: the bundle must talk to EdgeKV.
  const kv = new Map();
  t.after(installRuntime(kv));

  const { code } = buildEsaBundle({
    // Disable the write-through cache so the redirect must come from EdgeKV.
    env: { ...ESA_ENV, LOCAL_CACHE_TTL_SEC: '0' },
    useProcessEnv: false,
  });

  const module = await importCode(code);
  const { fetch } = module.default;
  assert.equal(typeof fetch, 'function');

  let response = await fetch(new Request('https://s.example.com/healthz'));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');

  response = await fetch(new Request('https://s.example.com/'));
  assert.equal(response.status, 200);
  const landing = await response.text();
  assert.ok(landing.includes('ESA Links'), 'PAGE_TITLE from the build env is used');
  assert.match(landing, /<form id="shortenForm"/);

  response = await fetch(new Request('https://s.example.com/api/shorten', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/esa-e2e' }),
  }));
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.shortUrl, `https://sho.rt/${created.code}`);

  response = await fetch(new Request(`https://s.example.com/${created.code}`, { redirect: 'manual' }));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.com/esa-e2e');

  response = await fetch(new Request(`https://s.example.com/${created.code}`, { method: 'HEAD', redirect: 'manual' }));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.com/esa-e2e');

  response = await fetch(new Request('https://s.example.com/nosuch1'));
  assert.equal(response.status, 404);
  assert.match(await response.text(), /404/);

  // Every physical key must satisfy the ESA key rules.
  const keys = [...kv.keys()].map((entry) => entry.slice(entry.indexOf('|') + 1));
  assert.ok(keys.length > 0, 'something was written to EdgeKV');
  assert.ok(keys.includes(`k_2f${created.code}`), `link stored under k_2f<code>, got ${keys.join(', ')}`);
  for (const key of keys) {
    assert.match(key, /^[A-Za-z0-9_-]+$/, `ESA-unsafe key "${key}"`);
    assert.ok(Buffer.byteLength(key, 'utf8') <= 512, `key "${key}" exceeds 512 bytes`);
  }
});

test('the app is built once and reused across requests', async (t) => {
  const kv = new Map();
  t.after(installRuntime(kv));

  const { code } = buildEsaBundle({ env: ESA_ENV, useProcessEnv: false });
  const module = await importCode(code);

  const first = await module.default.fetch(new Request('https://s.example.com/healthz'));
  assert.equal(await first.text(), 'ok');

  // The isolate keeps one app (and one EdgeKV handle) alive; a later request
  // must not depend on the global still being reachable.
  delete globalThis.EdgeKV;

  const second = await module.default.fetch(new Request('https://s.example.com/'));
  assert.equal(second.status, 200);
  assert.match(await second.text(), /<form id="shortenForm"/);
});

test('non-ASCII configuration survives bundling and rendering', async (t) => {
  const env = {
    ...ESA_ENV,
    PAGE_TITLE: '短链 · 测试',
    PAGE_ICON: '🔗',
    PAGE_DESC: '快速生成短链接',
  };

  const kv = new Map();
  t.after(installRuntime(kv, env));

  const { code } = buildEsaBundle({ env, useProcessEnv: false });
  assert.ok(code.includes('短链 · 测试'), 'the title is embedded as literal UTF-8');

  const module = await importCode(code);
  const landing = await (await module.default.fetch(new Request('https://s.example.com/'))).text();

  assert.ok(landing.includes('短链 · 测试'), 'title renders');
  assert.ok(landing.includes('🔗'), 'emoji icon renders');
  assert.ok(landing.includes('快速生成短链接'), 'description renders');
});

test('the bundle honours the ACCESS_KEY baked into it', async (t) => {
  const kv = new Map();
  const env = { ...ESA_ENV, ACCESS_KEY: 'key123456', LOCAL_CACHE_TTL_SEC: '0' };
  t.after(installRuntime(kv, env));

  const { code } = buildEsaBundle({ env, useProcessEnv: false });
  const { fetch } = (await importCode(code)).default;

  const root = await fetch(new Request('https://s.example.com/'));
  assert.equal(root.status, 404);
  assert.ok(!(await root.text()).includes('key123456'), 'the 404 page does not leak the key');

  const page = await fetch(new Request('https://s.example.com/key123456/'));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<form id="shortenForm"/);

  const created = await fetch(new Request('https://s.example.com/key123456/api/shorten', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/bundled' }),
  }));
  assert.equal(created.status, 201);
  assert.ok(!(await created.json()).shortUrl.includes('key123456'), 'short links stay public');
});

test('entry and bundle live in the project layout used by esa.jsonc', () => {
  const { modules } = buildEsaBundle({ env: ESA_ENV, useProcessEnv: false });
  assert.ok(modules.includes('esa/entry.mjs'));
  assert.ok(!modules.some((name) => name.startsWith('fc/')), 'the FC adapter must not leak into the ESA bundle');
  assert.ok(!modules.some((name) => name.startsWith('test/')), 'tests must not leak into the bundle');
});
