/**
 * Aliyun Function Compute 3.0 adapter.
 *
 * Maps the FC built-in-runtime HTTP event (payload version `v1`) to a Web
 * `Request`, runs the shared core, and maps the `Response` back to the
 * `{ statusCode, headers, body, isBase64Encoded }` structure FC expects.
 *
 * Event shape (from the Aliyun FC 3.0 docs):
 *   { version, rawPath, body, isBase64Encoded, headers, queryParameters,
 *     requestContext: { domainName, http: { method, path, protocol, sourceIp,
 *     userAgent }, requestId, time, timeEpoch } }
 */

import { createApp } from '../src/app.mjs';

/** Text-ish content types are returned as plain text, everything else as base64. */
const TEXTUAL_TYPES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/xml',
  'application/x-www-form-urlencoded',
  'image/svg+xml',
];

/**
 * Create the shared app for a Function Compute instance.
 * @param {Record<string, unknown>} env
 */
export function createFcApp(env) {
  return createApp(env);
}

/** FC may hand us a JSON string or a Buffer depending on the trigger type. */
function normalizeEvent(event) {
  if (!event) return {};
  if (typeof event === 'string') return JSON.parse(event);
  if (typeof event === 'object' && !Array.isArray(event) && !(event instanceof Uint8Array)) return event;
  if (event instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(event));
  return {};
}

function lowercaseHeaders(headers) {
  const result = {};
  if (!headers || typeof headers !== 'object') return result;

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    const key = name.toLowerCase();
    // FC adds a Content-Length that may not match the decoded body; the Request
    // constructor computes it, and a wrong value makes undici throw.
    if (key === 'content-length' || key === 'transfer-encoding') continue;
    result[key] = Array.isArray(value) ? value.join(',') : String(value);
  }

  return result;
}

function buildQuery(queryParameters) {
  if (!queryParameters || typeof queryParameters !== 'object') return '';
  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(queryParameters)) {
    if (value === undefined || value === null) continue;
    // FC joins repeated parameters with commas; we keep them as a single value
    // because this API only uses query parameters for convenience input.
    search.append(name, String(value));
  }

  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

function resolvePath(record, httpContext) {
  if (typeof httpContext.path === 'string' && httpContext.path) return httpContext.path;

  const rawPath = typeof record.rawPath === 'string' && record.rawPath ? record.rawPath : '/';
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

function decodeBody(record, method) {
  if (method === 'GET' || method === 'HEAD') return undefined;

  const raw = record.body;
  if (raw === undefined || raw === null || raw === '') return undefined;

  if (record.isBase64Encoded) {
    const binary = atob(String(raw));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  return String(raw);
}

/**
 * Convert an FC HTTP event into a Web Request.
 * @param {unknown} event
 * @returns {Request}
 */
export function eventToRequest(event) {
  const record = normalizeEvent(event);
  const requestContext = record.requestContext || {};
  const httpContext = requestContext.http || {};
  const headers = lowercaseHeaders(record.headers);

  const method = String(httpContext.method || record.httpMethod || 'GET').toUpperCase();
  const host = String(requestContext.domainName || headers.host || 'localhost');
  const protocol = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const path = resolvePath(record, httpContext);
  const query = buildQuery(record.queryParameters);

  if (httpContext.sourceIp && !headers['x-forwarded-for']) {
    headers['x-forwarded-for'] = String(httpContext.sourceIp);
  }

  const url = new URL(`${protocol}://${host}${path.startsWith('/') ? path : `/${path}`}${query}`);
  const body = decodeBody(record, method);

  return body === undefined
    ? new Request(url, { method, headers })
    : new Request(url, { method, headers, body });
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isTextual(contentType) {
  const value = contentType.toLowerCase();
  return TEXTUAL_TYPES.some((prefix) => value.includes(prefix));
}

/**
 * Convert a Web Response into the structure FC maps onto the HTTP response.
 * @param {Response} response
 */
export async function responseToEvent(response) {
  const headers = {};
  for (const [name, value] of response.headers) headers[name] = value;

  const buffer = new Uint8Array(await response.arrayBuffer());
  const textual = isTextual(response.headers.get('content-type') || '');

  if (buffer.length === 0) {
    return { statusCode: response.status, headers, isBase64Encoded: false, body: '' };
  }

  if (textual) {
    return {
      statusCode: response.status,
      headers,
      isBase64Encoded: false,
      body: new TextDecoder().decode(buffer),
    };
  }

  return { statusCode: response.status, headers, isBase64Encoded: true, body: toBase64(buffer) };
}

/**
 * FC handler body: event in, FC response structure out.
 * @param {unknown} event
 * @param {{handle: (request: Request) => Promise<Response>}} app
 */
export async function handleEvent(event, app) {
  return responseToEvent(await app.handle(eventToRequest(event)));
}
