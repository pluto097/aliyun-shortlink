/**
 * Node.js HTTP server.
 *
 * Used for three things:
 *   1. Aliyun FC "Web 函数" / custom container (listens on port 9000)
 *   2. `npm start` / `npm run dev` on any machine
 *   3. the end-to-end test, by importing `startServer()`
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.mjs';

const FC_DEFAULT_PORT = 9000;
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
 * @param {{env?: Record<string, unknown>, port?: number, host?: string, dev?: boolean}} [options]
 */
export async function startServer(options = {}) {
  const env = options.env ?? { ...process.env };
  const dev = options.dev ?? false;
  const port = options.port ?? Number(process.env.PORT || (dev ? DEV_DEFAULT_PORT : FC_DEFAULT_PORT));
  const host = options.host ?? '0.0.0.0';

  if (dev && !env.STORAGE) env.STORAGE = 'memory';

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

/** True when this module was started directly (`node fc/server.mjs`). */
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
  const dev = process.argv.includes('--dev');

  startServer({ dev })
    .then(({ url, app }) => {
      console.log(`[shortlink] storage=${app.store.name} listening on ${url}`);
      if (dev) console.log('[shortlink] dev mode: in-memory storage, data is lost on exit');
    })
    .catch((error) => {
      console.error('[shortlink] failed to start:', error);
      process.exitCode = 1;
    });
}
