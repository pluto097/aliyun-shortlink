/**
 * Aliyun Function Compute built-in runtime (Node.js) entry point.
 *
 * FC loads the handler with CommonJS semantics (`fc/index.handler`), so this
 * file stays CommonJS while the shared core stays ESM: the dynamic import runs
 * once per instance and is reused by every subsequent invocation.
 */

'use strict';

const ready = import('./event.mjs');

let appPromise;

async function bootstrap() {
  const mod = await ready;
  appPromise ??= mod.createFcApp(process.env);
  return { mod, app: await appPromise };
}

/**
 * @param {unknown} event FC HTTP trigger event (payload version v1)
 * @param {object} context FC invocation context (unused)
 */
exports.handler = async function handler(event, context) {
  const { mod, app } = await bootstrap();
  return mod.handleEvent(event, app);
};
