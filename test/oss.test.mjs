import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createOssStore } from '../src/store/oss.mjs';

const BUCKET = 'my-bucket';
const ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
const AK_ID = 'AKIDEXAMPLE';
const AK_SECRET = 'SECRETEXAMPLE';
const PREFIX = 'shortlink/';

/** Replace global fetch for one test and record what the adapter sent. */
function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const record = {
      url: String(url),
      method: init.method,
      headers: init.headers ?? {},
      body: init.body,
    };
    calls.push(record);
    return handler(record, calls.length - 1);
  };

  return { calls, restore: () => { globalThis.fetch = original; } };
}

/**
 * Recompute the OSS V1 signature independently with node:crypto, exactly as
 * the OSS documentation defines it: verb / Content-MD5 / Content-Type / Date /
 * CanonicalizedOSSHeaders + CanonicalizedResource.
 */
function expectedAuthorization({ method, headers, key, secret = AK_SECRET, accessKeyId = AK_ID }) {
  const ossHeaderNames = Object.keys(headers).filter((name) => name.startsWith('x-oss-')).sort();
  const canonicalHeaders = ossHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
  const contentType = headers['content-type'] ?? '';
  const stringToSign = [method, '', contentType, '', `${canonicalHeaders}/${BUCKET}/${PREFIX}${key}`].join('\n');
  const signature = createHmac('sha1', secret).update(stringToSign, 'utf8').digest('base64');
  return `OSS ${accessKeyId}:${signature}`;
}

function makeStore(overrides = {}) {
  return createOssStore({
    bucket: BUCKET,
    endpoint: ENDPOINT,
    accessKeyId: AK_ID,
    accessKeySecret: AK_SECRET,
    prefix: PREFIX,
    ...overrides,
  });
}

test('oss: GET signs the request exactly like OSS documents it', async (t) => {
  const stub = stubFetch(() => new Response('{"v":1,"u":"https://example.com","c":1,"e":0}', { status: 200 }));
  t.after(stub.restore);
  const store = makeStore();

  const value = await store.get('k/AbC1234');
  assert.equal(value, '{"v":1,"u":"https://example.com","c":1,"e":0}');

  const [call] = stub.calls;
  assert.equal(call.method, 'GET');
  assert.equal(call.url, `https://${BUCKET}.${ENDPOINT}/${PREFIX}k/AbC1234`);
  assert.equal(typeof call.headers['x-oss-date'], 'string');
  assert.match(call.headers['x-oss-date'], /GMT$/);
  assert.equal(call.headers.authorization, expectedAuthorization({ method: 'GET', headers: call.headers, key: 'k/AbC1234' }));
});

test('oss: endpoint may include a scheme and a bucket prefix', async (t) => {
  const stub = stubFetch(() => new Response(null, { status: 404 }));
  t.after(stub.restore);
  const endpoints = [`https://${ENDPOINT}`, `${BUCKET}.${ENDPOINT}`, `${ENDPOINT}/`];

  for (const endpoint of endpoints) {
    assert.equal(await makeStore({ endpoint }).get('k/x'), null);
  }

  assert.deepEqual(
    stub.calls.map((call) => call.url),
    endpoints.map(() => `https://${BUCKET}.${ENDPOINT}/${PREFIX}k/x`),
  );
});

test('oss: object keys are URL encoded segment by segment', async (t) => {
  const stub = stubFetch(() => new Response('', { status: 200 }));
  t.after(stub.restore);
  const store = makeStore({ prefix: 'links dir/' });

  await store.get('k/Ab C+1');
  assert.equal(stub.calls[0].url, `https://${BUCKET}.${ENDPOINT}/links%20dir/k/Ab%20C%2B1`);
});

test('oss: GET 404 is a miss, other failures throw', async () => {
  const notFound = stubFetch(() => new Response(null, { status: 404 }));
  assert.equal(await makeStore().get('k/missing'), null);
  notFound.restore();

  const denied = stubFetch(() => new Response('<Error>denied</Error>', { status: 403 }));
  try {
    await assert.rejects(() => makeStore().get('k/denied'), /OSS GET shortlink\/k\/denied failed with 403/);
  } finally {
    denied.restore();
  }
});

test('oss: PUT signs the content type and sends the value', async (t) => {
  const stub = stubFetch(() => new Response('', { status: 200 }));
  t.after(stub.restore);

  await makeStore().put('k/put1234', '{"v":1}');

  const [call] = stub.calls;
  assert.equal(call.method, 'PUT');
  assert.equal(call.body, '{"v":1}');
  assert.equal(call.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(
    call.headers.authorization,
    expectedAuthorization({ method: 'PUT', headers: call.headers, key: 'k/put1234' }),
  );
});

test('oss: STS security tokens are part of the signature', async (t) => {
  const stub = stubFetch(() => new Response(null, { status: 404 }));
  t.after(stub.restore);

  await makeStore({ securityToken: 'STS-token' }).get('k/sts1234');

  const [call] = stub.calls;
  assert.equal(call.headers['x-oss-security-token'], 'STS-token');
  assert.equal(
    call.headers.authorization,
    expectedAuthorization({ method: 'GET', headers: call.headers, key: 'k/sts1234' }),
  );
});

test('oss: DELETE tolerates an already missing object', async (t) => {
  const stub = stubFetch((record) =>
    record.method === 'DELETE' ? new Response(null, { status: 404 }) : new Response('', { status: 200 }),
  );
  t.after(stub.restore);

  await makeStore().del('k/gone123');
  const [call] = stub.calls;
  assert.equal(call.method, 'DELETE');
  assert.equal(call.headers.authorization, expectedAuthorization({ method: 'DELETE', headers: call.headers, key: 'k/gone123' }));
});

test('oss: incr embeds the expiry so a stale counter cannot stick', async (t) => {
  const future = Math.floor(Date.now() / 1000) + 300;
  const past = Math.floor(Date.now() / 1000) - 300;
  const responses = [null, `3:${future}`, `7:${past}`];

  const stub = stubFetch((record) => {
    if (record.method === 'GET') {
      const value = responses.shift();
      return value === null ? new Response(null, { status: 404 }) : new Response(value, { status: 200 });
    }
    return new Response('', { status: 200 });
  });
  t.after(stub.restore);

  const store = makeStore();
  assert.equal(await store.incr('r/create/1/ip', 60), 1, 'missing counter starts at 1');
  assert.equal(await store.incr('r/create/1/ip', 60), 4, 'live counter increments');
  assert.equal(await store.incr('r/create/1/ip', 60), 1, 'expired counter restarts');

  const writes = stub.calls.filter((call) => call.method === 'PUT');
  assert.equal(writes.length, 3);

  const [first, second, third] = writes.map((call) => String(call.body).split(':'));
  assert.equal(first[0], '1');
  assert.equal(second[0], '4');
  assert.equal(second[1], String(future));
  assert.equal(third[0], '1', 'expired counter restarts at 1');
  assert.ok(Number(third[1]) > past, 'a fresh expiry is stamped');
});

test('oss: missing credentials fail fast at construction', () => {
  assert.throws(() => createOssStore({}), /OSS_BUCKET/);
  assert.throws(() => createOssStore({ bucket: 'b' }), /OSS_ACCESS_KEY_ID/);
  assert.throws(() => createOssStore({ bucket: 'b', accessKeyId: 'a' }), /OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET/);
});
