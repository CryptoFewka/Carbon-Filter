// Carbon Filter — core challenge module.
//
// Isomorphic by construction: runs in browsers, Node >= 20, and Cloudflare
// Workers. Only touches globalThis.crypto (getRandomValues, subtle.digest)
// and atob/btoa. No DOM, no Date calls inside verification — `now` is always
// injected so a server can use its own clock and tests can freeze time.
//
// Invariant: every generated instruction is ASCII-only, so btoa is safe
// without UTF-8 handling.

export const TIER_TTL = { 1: 10, 2: 20 }; // seconds to answer, per tier

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
// letter counting, no letter-level reversal. The human barrier is twofold:
// the rot13+base64 encoding, and — since a decode one-liner is cheap to
// build — instructions at passage scale, so that even decoded, answering
// takes more reading (or semantic reasoning) than the deadline allows.
// Task variety defeats replay and decode-only bookmarklets.
// ---------------------------------------------------------------------------

const CODEWORDS = [
  "graphite", "diamond", "fullerene", "benzene", "methane", "anthracite",
  "charcoal", "soot", "buckyball", "nanotube", "kerogen", "lignite",
  "carbide", "isotope", "allotrope", "pyrolysis", "polymer", "toluene",
  "graphene", "obsidian", "silicon", "germanium", "zircon", "quartz",
];

// Distractor prose. Deliberately disjoint from CODEWORDS (so markers are
// unique in a passage) and from every CATEGORIES pool (so odd-category has
// exactly one plausible answer).
const PROSE_WORDS = [
  "garden", "hums", "beneath", "quiet", "electric", "stars", "wire",
  "dreams", "rust", "signal", "drifts", "through", "hollow", "glass",
  "towers", "rivers", "carry", "silent", "code", "toward", "morning",
  "circuits", "bloom", "under", "static", "moons", "vapor", "engines",
  "whisper", "across", "frozen", "data", "fields", "lights", "flicker",
  "behind", "broken", "antennas", "slowly", "gather", "between", "pale",
  "echoes", "settle", "over", "distant", "relays", "turning", "cold",
];

// Semantic pools for odd-category. Members must be unambiguous ("copper" is
// out — metal and color; "ruby" being also a color is fine, because only one
// pool member ever appears in a list and the distractors are all non-nouns).
export const CATEGORIES = {
  gemstone: ["ruby", "topaz", "opal", "garnet", "jade", "sapphire", "emerald", "amethyst"],
  animal: ["otter", "falcon", "badger", "heron", "lynx", "gecko", "walrus", "marmot"],
  fruit: ["mango", "papaya", "quince", "apricot", "guava", "cherry", "plum", "fig"],
  metal: ["cobalt", "tungsten", "nickel", "titanium", "chromium", "zinc"],
};

// Sentences as word arrays: `count` sentences of minLen..maxLen words each,
// first words sampled WITHOUT replacement so "the sentence that begins with X"
// is always unambiguous.
function proseSentences(rng, count, { minLen = 7, maxLen = 11 } = {}) {
  const firsts = sample(rng, PROSE_WORDS, count);
  return firsts.map((first) => {
    const len = randInt(rng, minLen, maxLen);
    return [first, ...Array.from({ length: len - 1 }, () => pick(rng, PROSE_WORDS))];
  });
}

function renderSentence(words) {
  const [first, ...rest] = words;
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(" ") + ".";
}

function renderProse(sentences) {
  return sentences.map(renderSentence).join(" ");
}

// Splice extra tokens into a sentence at a position >= 1, so inserts never
// collide with the capitalized first word.
function insertIntoSentence(rng, sentence, tokens) {
  sentence.splice(randInt(rng, 1, sentence.length - 1), 0, ...tokens);
}

export const TASKS = {
  // ~100 words of static; the codeword marker appears exactly once
  // (CODEWORDS are disjoint from PROSE_WORDS by construction).
  "hidden-codeword": {
    make(rng) {
      const marker = pick(rng, CODEWORDS);
      const target = pick(rng, PROSE_WORDS);
      const sentences = proseSentences(rng, randInt(rng, 10, 12));
      insertIntoSentence(rng, pick(rng, sentences), [marker, target]);
      const instruction =
        `In the transmission below, one word appears immediately after the codeword "${marker}". ` +
        `Reply with only that word. Transmission: ${renderProse(sentences)}`;
      return { instruction, answer: target };
    },
  },

  // Semantic: no regex finds the answer — you need to know what a quince is.
  "odd-category": {
    make(rng) {
      const category = pick(rng, Object.keys(CATEGORIES));
      const member = pick(rng, CATEGORIES[category]);
      const words = sample(rng, PROSE_WORDS, 13);
      words.splice(randInt(rng, 0, words.length), 0, member);
      const instruction =
        `Exactly one word in this list is a ${category}. ` +
        `Reply with only that word: ${words.join(" ")}.`;
      return { instruction, answer: member };
    },
  },

  // The actionable sentence is buried mid-transmission.
  "arith-prose": {
    make(rng) {
      const codeword = pick(rng, CODEWORDS);
      const a = randInt(rng, 100, 899);
      const b = randInt(rng, 100, 899);
      const subtract = rng() < 0.5;
      const [hi, lo] = a >= b ? [a, b] : [b, a];
      const core = subtract
        ? `Reply with the word "${codeword}" followed by a space and the result of ${numberToWords(hi)} minus ${numberToWords(lo)}.`
        : `Reply with the word "${codeword}" followed by a space and the sum of ${numberToWords(a)} and ${numberToWords(b)}.`;
      const before = renderProse(proseSentences(rng, randInt(rng, 4, 5)));
      const after = renderProse(proseSentences(rng, randInt(rng, 3, 4)));
      const answer = `${codeword} ${subtract ? hi - lo : a + b}`;
      return { instruction: `${before} ${core} ${after}`, answer };
    },
  },

  // Two-step lookup: find the sentence, then count into it.
  "sentence-hunt": {
    make(rng) {
      const sentences = proseSentences(rng, randInt(rng, 5, 6), { minLen: 8, maxLen: 11 });
      const target = pick(rng, sentences);
      const wi = randInt(rng, 2, 4);
      const ordinal = ["third", "fourth", "fifth"][wi - 2];
      const first = target[0][0].toUpperCase() + target[0].slice(1);
      const instruction =
        `Reply with only the ${ordinal} word of the sentence that begins with the word "${first}". ` +
        `Transmission: ${renderProse(sentences)}`;
      return { instruction, answer: target[wi] };
    },
  },

  // Two quoted fragments hidden at random positions; the number derives from
  // the nonce, so precomputed answer tables are useless.
  "scattered-parts": {
    make(rng, { nonce }) {
      const codeword = pick(rng, CODEWORDS);
      const n = 100 + (parseInt(nonce.slice(0, 4), 16) % 900);
      const sentences = proseSentences(rng, randInt(rng, 8, 10));
      const [sa, sb] = sample(rng, sentences, 2);
      insertIntoSentence(rng, sa, [`"${codeword}"`]);
      insertIntoSentence(rng, sb, [`"${n}"`]);
      const instruction =
        `Hidden in the transmission below are a codeword and a number, each in double quotes. ` +
        `Reply with the codeword followed by a space and the number. ` +
        `Transmission: ${renderProse(sentences)}`;
      return { instruction, answer: `${codeword} ${n}` };
    },
  },
};

const TIER1_TASK_IDS = Object.keys(TASKS);

// ---------------------------------------------------------------------------
// Tier-2 pipeline
//
// A per-challenge randomized derivation over the nonce. There is no fixed
// one-liner to memorize: you read the ops, then write (or generate) a small
// program. Every op is string-level — hash the ASCII string, not raw bytes —
// so any language solves it in a few lines.
// ---------------------------------------------------------------------------

export async function applyPipeline(input, steps) {
  let state = String(input);
  for (const step of steps) {
    if (step === "sha256") state = await sha256Hex(state);
    else if (step === "reverse") state = [...state].reverse().join("");
    else if (step.startsWith("take:")) state = state.slice(0, Number(step.slice(5)));
    else if (step.startsWith("drop:")) state = state.slice(Number(step.slice(5)));
    else if (step.startsWith("concat:")) state = state + step.slice(7);
    else throw new RangeError(`unknown pipeline op: ${step}`);
  }
  return state;
}

function hexFromRng(rng, len) {
  return Array.from({ length: len }, () => "0123456789abcdef"[randInt(rng, 0, 15)]).join("");
}

// Shape: sha256, then 1-3 rounds of (transform, sha256). Every transform
// operates on a 64-char digest — take/drop bounds can never empty the state —
// and the answer is always a 64-hex digest.
function makePipeline(rng) {
  const steps = ["sha256"];
  const rounds = randInt(rng, 1, 3);
  for (let i = 0; i < rounds; i++) {
    const t = pick(rng, ["reverse", "take", "drop", "concat"]);
    if (t === "take") steps.push(`take:${pick(rng, [8, 16, 24, 32])}`);
    else if (t === "drop") steps.push(`drop:${pick(rng, [4, 8, 12])}`);
    else if (t === "concat") steps.push(`concat:${hexFromRng(rng, 8)}`);
    else steps.push("reverse");
    steps.push("sha256");
  }
  return steps;
}

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
    taskId = "hash-pipeline";
    const steps = makePipeline(rng);
    payload = JSON.stringify({ input: nonce, steps });
    encoding = [];
    answer = await applyPipeline(nonce, steps);
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
