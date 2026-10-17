/**
 * Shared test helpers. Every test builds an isolated app: its own in-memory
 * store and its own clock, so tests never leak state into each other.
 */

import { createApp } from '../src/app.mjs';
import { LinkStore, createStore } from '../src/store/index.mjs';
import { createMemoryStore } from '../src/store/memory.mjs';

export const ORIGIN = 'https://s.example.com';

/**
 * Build an app with in-memory storage.
 * @param {Record<string, string>} [env]
 * @param {{now?: () => number, storage?: object}} [options]
 */
export async function makeApp(env = {}, options = {}) {
  const now = options.now ?? (() => Date.now());
  const store = new LinkStore(options.storage ?? createMemoryStore({ now }), { now });

  const app = await createApp(
    { STORAGE: 'memory', RL_MAX_REQ: '0', ...env },
    { store, now },
  );

  return app;
}

/** Perform a request against an app. */
export function call(app, path, init) {
  return app.handle(new Request(ORIGIN + path, init));
}

/** POST JSON to the primary create endpoint. */
export function postJson(app, payload, headers = {}) {
  return call(app, '/api/shorten', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

/** Create a link and return the parsed body. */
export async function createLink(app, payload) {
  const response = await postJson(app, payload);
  return { response, body: await response.json() };
}

export { createApp, createMemoryStore, createStore, LinkStore };
