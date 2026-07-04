// HMAC-SHA256 sealing for challenge tokens and gate cookies.
//
// Isomorphic like the core module: only crypto.subtle and btoa/atob, so it
// runs in Cloudflare Workers, browsers, and Node >= 20 (which is how the
// tests drive it).

const encoder = new TextEncoder();

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// Seals a JSON-serializable object into "base64url(json).base64url(mac)".
export async function sealToken(obj, secret) {
  const payload = toBase64Url(encoder.encode(JSON.stringify(obj)));
  const key = await hmacKey(secret);
  const mac = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(mac))}`;
}

// Returns the sealed object, or null for anything malformed or tampered.
export async function openToken(token, secret) {
  try {
    const [payload, mac] = String(token).split(".");
    if (!payload || !mac) return null;
    const key = await hmacKey(secret);
    const valid = await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(mac),
      encoder.encode(payload),
    );
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    return null;
  }
}
