/**
 * Local preview server for the short link service.
 *
 * Production runs on Aliyun ESA "函数和 Pages" (see esa/entry.mjs) with Edge KV
 * storage. This Node server exists so the landing page and the API can be tried
 * without deploying: it defaults to the in-memory store, so every restart
 * starts empty.
 *
 *   npm run dev            # http://127.0.0.1:8787, in-memory storage
 *   PORT=9000 npm run dev  # any other port
 *
 * It is also imported by the end-to-end test, which starts it on port 0.
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.mjs';

const DEV_DEFAULT_PORT = 8787;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    request.on('error', reject);
  });
}

/**
 * Start the HTTP server and return a handle to it.
 * @param {{env?: Record<string, unknown>, port?: number, host?: string}} [options]
 */
export async function startServer(options = {}) {
  const env = options.env ?? { ...process.env };
  const port = options.port ?? Number(process.env.PORT || DEV_DEFAULT_PORT);
  const host = options.host ?? '127.0.0.1';

  // ESA has Edge KV; a local process does not, unless the deployment config
  // explicitly asks for it (then the adapter reports the missing runtime).
  if (!env.STORAGE) env.STORAGE = 'memory';

  const app = await createApp(env);

  const server = createServer(async (request, response) => {
    try {
      const body = await readBody(request);
      const method = (request.method || 'GET').toUpperCase();
      const hostHeader = request.headers.host || `${host}:${port}`;
      const url = new URL(request.url || '/', `http://${hostHeader}`);

      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined || name === 'content-length' || name === 'transfer-encoding') continue;
        headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      }

      const webRequest = new Request(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
      });

      const webResponse = await app.handle(webRequest);
      const payload = Buffer.from(await webResponse.arrayBuffer());

      const outHeaders = {};
      for (const [name, value] of webResponse.headers) outHeaders[name] = value;
      outHeaders['content-length'] = String(payload.length);

      response.writeHead(webResponse.status, outHeaders);
      response.end(payload);
    } catch (error) {
      console.error('[shortlink] request failed:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      }
      response.end('Internal server error');
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    server,
    app,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** True when this module was started directly (`node scripts/serve.mjs`). */
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  startServer()
    .then(({ url, app }) => {
      console.log(`[shortlink] storage=${app.store.name} listening on ${url}`);
      if (app.store.name === 'memory') {
        console.log('[shortlink] local preview: storage=memory, data is lost on exit');
        console.log('[shortlink] production runs on Aliyun ESA with Edge KV — see docs/DEPLOY-ALIYUN-ESA.md');
      }
    })
    .catch((error) => {
      console.error('[shortlink] failed to start:', error);
      process.exitCode = 1;
    });
}
