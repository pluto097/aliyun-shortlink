/**
 * Cloudflare Workers entry point (optional).
 *
 * Cloudflare Pages uses `functions/[[path]].js`; deploy this file only if you
 * prefer a plain Worker (`wrangler deploy -c wrangler.worker.jsonc`).
 */

import { createApp } from './src/app.mjs';

let appPromise;

export default {
  /**
   * @param {Request} request
   * @param {Record<string, unknown>} env
   */
  async fetch(request, env) {
    appPromise ??= createApp(env);
    const app = await appPromise;
    return app.handle(request);
  },
};
