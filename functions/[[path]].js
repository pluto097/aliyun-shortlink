/**
 * Cloudflare Pages Functions entry point.
 *
 * `functions/[[path]].js` matches every path, so Pages hands us the whole
 * request and the shared core does the rest. The app (and with it the KV
 * binding) is created once per isolate.
 */

import { createApp } from '../src/app.mjs';

let appPromise;

/** @param {EventContext} context */
export async function onRequest(context) {
  appPromise ??= createApp(context.env);
  const app = await appPromise;
  return app.handle(context.request);
}
