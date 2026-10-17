/**
 * SHA-256 hex digest via WebCrypto.
 *
 * Lives in its own module so both the storage facade and the adapters can use
 * it without creating an import cycle.
 */

/**
 * @param {string} value
 * @returns {Promise<string>} lowercase hex digest
 */
export async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('crypto.subtle is unavailable in this runtime');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
