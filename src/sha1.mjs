/**
 * Dependency-free SHA-1 / HMAC-SHA1 / Base64.
 *
 * The Aliyun OSS adapter signs requests with HMAC-SHA1. Rather than depend on
 * WebCrypto (whose SHA-1 support differs between Cloudflare Workers and older
 * Node builds) we ship one deterministic implementation that is verified
 * against `node:crypto` in the test suite.
 *
 * SHA-1 is used here purely as an OSS request-signing primitive; it is not
 * used for any security decision inside this service.
 */

const BLOCK_SIZE = 64;

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode bytes as standard (padded) Base64.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base64(bytes) {
  let out = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
  }

  return out;
}

/** UTF-8 encode a string. */
function utf8(value) {
  return new TextEncoder().encode(value);
}

/**
 * Compute the SHA-1 digest of a byte array.
 * @param {Uint8Array} message
 * @returns {Uint8Array} 20-byte digest
 */
export function sha1(message) {
  const bitLength = message.length * 8;
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const words = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += BLOCK_SIZE) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4);

    for (let i = 16; i < 80; i += 1) {
      const x = words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16];
      words[i] = (x << 1) | (x >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f;
      let k;

      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + words[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, h0);
  digestView.setUint32(4, h1);
  digestView.setUint32(8, h2);
  digestView.setUint32(12, h3);
  digestView.setUint32(16, h4);
  return digest;
}

/**
 * HMAC-SHA1 over raw bytes.
 * @param {Uint8Array} key
 * @param {Uint8Array} message
 * @returns {Uint8Array} 20-byte MAC
 */
export function hmacSha1(key, message) {
  const normalizedKey = key.length > BLOCK_SIZE ? sha1(key) : key;
  const ipad = new Uint8Array(BLOCK_SIZE);
  const opad = new Uint8Array(BLOCK_SIZE);

  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    const byte = i < normalizedKey.length ? normalizedKey[i] : 0;
    ipad[i] = byte ^ 0x36;
    opad[i] = byte ^ 0x5c;
  }

  const inner = sha1(concat(ipad, message));
  return sha1(concat(opad, inner));
}

/** Concatenate two byte arrays. */
function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Base64(HMAC-SHA1(secret, message)) — the exact shape Aliyun OSS expects.
 * @param {string} secret
 * @param {string} message
 * @returns {string}
 */
export function hmacSha1Base64(secret, message) {
  return base64(hmacSha1(utf8(secret), utf8(message)));
}

export { utf8 };
