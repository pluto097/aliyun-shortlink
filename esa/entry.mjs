/**
 * Aliyun ESA "函数和 Pages" — edge function entry point.
 *
 * ESA expects a single ES module whose default export handles `fetch`:
 *
 *   export default { fetch(request) { ... } }
 *
 * Because ESA uploads exactly one JavaScript file (4 MB limit) with no module
 * resolution and no environment-variable binding, this file is bundled by
 * `scripts/build-esa.mjs`, which:
 *   - inlines every `src/` module into one file,
 *   - injects the deployment config as `ESA_BUILD_ENV`.
 *
 * Configuration precedence: `globalThis.__SHORTLINK_ENV__` (useful for tests)
 * wins over the build-time values.
 */

import { createApp } from '../src/app.mjs';

/** Injected by the bundler; absent when this file is imported directly. */
const BUILD_ENV = typeof ESA_BUILD_ENV === 'object' && ESA_BUILD_ENV !== null ? ESA_BUILD_ENV : {};

function readEnv() {
  const runtime = globalThis.__SHORTLINK_ENV__;
  const env = {
    ...BUILD_ENV,
    ...(runtime && typeof runtime === 'object' ? runtime : {}),
  };

  if (!env.STORAGE) env.STORAGE = 'esakv';

  // Long URL dedup needs SHA-256. Degrade instead of failing every request if
  // the runtime does not expose WebCrypto.
  if (!globalThis.crypto?.subtle && String(env.DEDUP_TTL_SEC ?? '0') !== '0') {
    console.warn('[shortlink] crypto.subtle is unavailable: long URL dedup disabled');
    env.DEDUP_TTL_SEC = '0';
  }

  return env;
}

let appPromise;

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    appPromise ??= createApp(readEnv());
    const app = await appPromise;
    return app.handle(request);
  },
};
