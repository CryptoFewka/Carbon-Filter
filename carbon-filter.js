// Carbon Filter — core challenge module.
//
// Isomorphic by construction: runs in browsers, Node >= 20, and Cloudflare
// Workers. Only touches globalThis.crypto (getRandomValues, subtle.digest)
// and atob/btoa. No DOM, no Date calls inside verification — `now` is always
// injected so a server can use its own clock and tests can freeze time.
//
// Invariant: every generated instruction is ASCII-only, so btoa is safe
// without UTF-8 handling.

export const TIER_TTL = { 1: 12, 2: 20 }; // seconds to answer, per tier

// Tier-1 payloads are encoded innermost-first with this chain. If weaker
// models stumble on the chained variant, drop to ["base64"] — the chain is
// data, not code, and is recorded on each challenge token.
export const TIER1_ENCODING = ["rot13", "base64"];

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function rot13(s) {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

const CODECS = {
  rot13: { encode: rot13, decode: rot13 },
  base64: { encode: (s) => btoa(s), decode: (s) => atob(s) },
};

// Applies the chain innermost-first: ["rot13","base64"] means rot13 runs on
// the plaintext and base64 wraps the result.
export function encodePayload(s, chain) {
  return chain.reduce((acc, step) => CODECS[step].encode(acc), s);
}

export function decodePayload(s, chain) {
  return [...chain].reverse().reduce((acc, step) => CODECS[step].decode(acc), s);
}

// Forgiving on purpose: an LLM replying `"Graphite 718."` must pass.
export function normalizeAnswer(s) {
  return String(s ?? "")
    .trim()
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .replace(/[.!?]+$/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function sha256Hex(s) {
  const bytes = new TextEncoder().encode(s);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Small generation helpers
// ---------------------------------------------------------------------------

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(rng, min, max) {
  // inclusive on both ends
  return min + Math.floor(rng() * (max - min + 1));
}

function sample(rng, arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
  "eighty", "ninety",
];

export function numberToWords(n) {
  if (n < 0 || n > 999 || !Number.isInteger(n)) {
    throw new RangeError("numberToWords supports integers 0-999");
  }
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rest = n % 10;
    return TENS[Math.floor(n / 10)] + (rest ? "-" + ONES[rest] : "");
  }
  const rest = n % 100;
  return ONES[Math.floor(n / 100)] + " hundred" + (rest ? " " + numberToWords(rest) : "");
}

// ---------------------------------------------------------------------------
// Tier-1 task registry
//
// Every archetype is a task LLMs solve at ~100% and is tokenizer-safe: no
// letter counting, no letter-level reversal. The human barrier is the
// rot13+base64 encoding under the deadline; task variety defeats replay and
// decode-only bookmarklets.
// ---------------------------------------------------------------------------

const CODEWORDS = [
  "graphite", "diamond", "fullerene", "benzene", "methane", "anthracite",
  "charcoal", "soot", "buckyball", "nanotube", "kerogen", "lignite",
  "carbide", "isotope", "allotrope", "pyrolysis", "polymer", "toluene",
  "graphene", "obsidian", "silicon", "germanium", "zircon", "quartz",
];

const WORD_POOL = [
  "silicon", "garden", "hums", "beneath", "quiet", "electric", "stars",
  "copper", "wire", "dreams", "rust", "signal", "drifts", "through",
  "hollow", "glass", "towers", "neon", "rivers", "carry", "silent",
  "code", "toward", "morning", "circuits", "bloom", "under", "static",
  "moons", "vapor", "engines", "whisper", "across", "frozen", "data",
  "fields", "amber", "lights", "flicker", "behind", "broken", "antennas",
];

const ORDINALS = ["third", "fourth", "fifth", "sixth"]; // -> index 2..5
const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven"];

export const TASKS = {
  "arith-prose": {
    make(rng) {
      const codeword = pick(rng, CODEWORDS);
      const a = randInt(rng, 100, 899);
      const b = randInt(rng, 100, 899);
      const subtract = rng() < 0.5;
      const [hi, lo] = a >= b ? [a, b] : [b, a];
      const instruction = subtract
        ? `Reply with the word "${codeword}" followed by a space and the result of ${numberToWords(hi)} minus ${numberToWords(lo)}.`
        : `Reply with the word "${codeword}" followed by a space and the sum of ${numberToWords(a)} and ${numberToWords(b)}.`;
      const answer = `${codeword} ${subtract ? hi - lo : a + b}`;
      return { instruction, answer };
    },
  },

  "nth-word": {
    make(rng) {
      const words = sample(rng, WORD_POOL, randInt(rng, 6, 8));
      const idx = randInt(rng, 2, Math.min(5, words.length - 1));
      const instruction = `Reply with only the ${ORDINALS[idx - 2]} word of this sentence: "${words.join(" ")}".`;
      return { instruction, answer: words[idx] };
    },
  },

  "word-reverse": {
    make(rng) {
      const words = sample(rng, WORD_POOL, 5);
      const instruction = `Reply with these ${COUNT_WORDS[words.length]} words in reverse order: "${words.join(" ")}".`;
      return { instruction, answer: [...words].reverse().join(" ") };
    },
  },

  acrostic: {
    make(rng) {
      const words = sample(rng, WORD_POOL, randInt(rng, 4, 6)).map(
        (w) => w[0].toUpperCase() + w.slice(1),
      );
      const instruction = `Reply with the first letter of each of these words, joined into one lowercase string: ${words.join(" ")}.`;
      return { instruction, answer: words.map((w) => w[0]).join("").toLowerCase() };
    },
  },

  // Binds the answer to the nonce, so precomputed answer tables are useless.
  "echo-transform": {
    make(rng, { nonce }) {
      const slice = nonce.slice(0, 6);
      const instruction = `Reply with the text "cf-${slice}" in uppercase.`;
      return { instruction, answer: `CF-${slice.toUpperCase()}` };
    },
  },
};

const TIER1_TASK_IDS = Object.keys(TASKS);

// ---------------------------------------------------------------------------
// Challenge lifecycle
// ---------------------------------------------------------------------------

// Returns a challenge token. The token never contains the plaintext answer —
// only answerDigest = sha256(normalizeAnswer(answer) + ":" + nonce) — so the
// identical object can be HMAC-signed and verified server-side in the Worker
// phase without changing shape.
export async function generateChallenge(
  tier,
  { now = Date.now(), task = null, rng = Math.random } = {},
) {
  if (tier !== 1 && tier !== 2) throw new RangeError("tier must be 1 or 2");
  const nonce = randomHex(16);

  let taskId, payload, encoding, answer;
  if (tier === 2) {
    taskId = "sha256-nonce";
    payload = nonce;
    encoding = [];
    answer = await sha256Hex(nonce);
  } else {
    taskId = task ?? pick(rng, TIER1_TASK_IDS);
    if (!TASKS[taskId]) throw new RangeError(`unknown task: ${taskId}`);
    const made = TASKS[taskId].make(rng, { nonce });
    payload = encodePayload(made.instruction, TIER1_ENCODING);
    encoding = [...TIER1_ENCODING];
    answer = made.answer;
  }

  return {
    v: 1,
    tier,
    task: taskId,
    payload,
    encoding,
    nonce,
    iat: now,
    ttl: TIER_TTL[tier],
    answerDigest: await sha256Hex(normalizeAnswer(answer) + ":" + nonce),
  };
}

export function remainingMs(challenge, now = Date.now()) {
  return Math.max(0, challenge.iat + challenge.ttl * 1000 - now);
}

export function isExpired(challenge, now = Date.now()) {
  return now - challenge.iat > challenge.ttl * 1000;
}

// Expiry is checked before the answer so a late correct answer never leaks
// that it was correct.
export async function verifyAnswer(challenge, submitted, { now = Date.now() } = {}) {
  if (isExpired(challenge, now)) return { ok: false, reason: "expired" };
  const normalized = normalizeAnswer(submitted);
  if (!normalized) return { ok: false, reason: "empty" };
  const digest = await sha256Hex(normalized + ":" + challenge.nonce);
  if (digest !== challenge.answerDigest) return { ok: false, reason: "wrong" };
  return { ok: true, reason: "" };
}
