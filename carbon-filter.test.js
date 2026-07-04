import test from "node:test";
import assert from "node:assert/strict";
import {
  TASKS,
  TIER_TTL,
  TIER1_ENCODING,
  applyPipeline,
  decodePayload,
  encodePayload,
  generateChallenge,
  isExpired,
  normalizeAnswer,
  numberToWords,
  randomHex,
  remainingMs,
  rot13,
  sha256Hex,
  verifyAnswer,
} from "./carbon-filter.js";

test("rot13 is an involution and preserves non-letters", () => {
  const s = 'Reply with "graphite 718"! (100% sure)';
  assert.equal(rot13(rot13(s)), s);
  assert.equal(rot13("abcNOP"), "nopABC");
});

test("encodePayload/decodePayload round-trip", () => {
  const s = "The quick brown fox, 481 + 237.";
  for (const chain of [["base64"], ["rot13", "base64"], []]) {
    assert.equal(decodePayload(encodePayload(s, chain), chain), s);
  }
  // innermost-first: base64 wraps the rot13 output
  assert.equal(encodePayload("abc", ["rot13", "base64"]), btoa(rot13("abc")));
});

test("normalizeAnswer is forgiving", () => {
  assert.equal(normalizeAnswer('  "Graphite 718." '), "graphite 718");
  assert.equal(normalizeAnswer("`nova`"), "nova");
  assert.equal(normalizeAnswer("rust   of\tdreams"), "rust of dreams");
  assert.equal(normalizeAnswer("ABC123DEF!"), "abc123def");
  assert.equal(normalizeAnswer(null), "");
  assert.equal(normalizeAnswer("   "), "");
});

test("numberToWords covers 0-999", () => {
  assert.equal(numberToWords(0), "zero");
  assert.equal(numberToWords(17), "seventeen");
  assert.equal(numberToWords(40), "forty");
  assert.equal(numberToWords(86), "eighty-six");
  assert.equal(numberToWords(100), "one hundred");
  assert.equal(numberToWords(718), "seven hundred eighteen");
  assert.equal(numberToWords(999), "nine hundred ninety-nine");
  assert.throws(() => numberToWords(1000), RangeError);
  assert.throws(() => numberToWords(-1), RangeError);
});

test("sha256Hex matches a known vector", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("randomHex length and charset", () => {
  const h = randomHex(16);
  assert.match(h, /^[0-9a-f]{32}$/);
});

for (const taskId of Object.keys(TASKS)) {
  test(`tier-1 archetype ${taskId}: 50 generations verify, decode, stay ASCII`, async () => {
    for (let i = 0; i < 50; i++) {
      const ch = await generateChallenge(1, { task: taskId });
      assert.equal(ch.v, 1);
      assert.equal(ch.tier, 1);
      assert.equal(ch.task, taskId);
      assert.equal(ch.ttl, TIER_TTL[1]);
      assert.deepEqual(ch.encoding, TIER1_ENCODING);

      const instruction = decodePayload(ch.payload, ch.encoding);
      assert.match(instruction, /^[\x20-\x7e]+$/, "instruction must be printable ASCII");

      assert.deepEqual(await verifyAnswer(ch, "definitely not the answer"), {
        ok: false,
        reason: "wrong",
      });
      assert.deepEqual(await verifyAnswer(ch, "   "), { ok: false, reason: "empty" });
    }
  });

  test(`tier-1 archetype ${taskId}: known answer verifies with frozen rng`, async () => {
    // Deterministic rng: replay the same sequence for make() and generate.
    for (let seed = 0; seed < 20; seed++) {
      const seq = mulberry32(seed);
      const values = Array.from({ length: 64 }, () => seq());
      const rngA = replay(values);
      const rngB = replay(values);
      const ch = await generateChallenge(1, { task: taskId, rng: rngA });
      const made = TASKS[taskId].make(rngB, { nonce: ch.nonce });
      assert.deepEqual(await verifyAnswer(ch, made.answer), { ok: true, reason: "" });
      // An LLM-ish messy rendition also passes
      assert.deepEqual(await verifyAnswer(ch, `  "${made.answer.toUpperCase()}."`), {
        ok: true,
        reason: "",
      });
    }
  });
}

test("applyPipeline op semantics", async () => {
  assert.equal(await applyPipeline("abc", ["sha256"]), await sha256Hex("abc"));
  assert.equal(await applyPipeline("abcdef", ["take:3"]), "abc");
  assert.equal(await applyPipeline("abcdef", ["drop:2"]), "cdef");
  assert.equal(await applyPipeline("abc", ["reverse"]), "cba");
  assert.equal(await applyPipeline("abc", ["concat:12"]), "abc12");
  assert.equal(
    await applyPipeline("abc", ["sha256", "take:16", "reverse", "sha256"]),
    await sha256Hex([...(await sha256Hex("abc")).slice(0, 16)].reverse().join("")),
  );
  await assert.rejects(() => applyPipeline("x", ["rot26"]), RangeError);
});

test("tier 2: randomized hash pipeline verifies, case-insensitively", async () => {
  for (let i = 0; i < 25; i++) {
    const ch = await generateChallenge(2);
    assert.equal(ch.task, "hash-pipeline");
    assert.deepEqual(ch.encoding, []);
    assert.equal(ch.ttl, TIER_TTL[2]);

    const { input, steps } = JSON.parse(ch.payload);
    assert.equal(input, ch.nonce);
    assert.equal(steps[0], "sha256");
    assert.equal(steps.at(-1), "sha256");
    assert.ok(steps.length >= 3 && steps.length <= 7, "3-7 steps");

    const answer = await applyPipeline(input, steps);
    assert.match(answer, /^[0-9a-f]{64}$/, "answer is always a full digest");
    assert.deepEqual(await verifyAnswer(ch, answer), { ok: true, reason: "" });
    assert.deepEqual(await verifyAnswer(ch, answer.toUpperCase()), { ok: true, reason: "" });
    assert.deepEqual(await verifyAnswer(ch, answer.slice(0, 63)), {
      ok: false,
      reason: "wrong",
    });
    // the memorized old one-liner no longer cuts it
    assert.deepEqual(await verifyAnswer(ch, await sha256Hex(ch.nonce)), {
      ok: false,
      reason: "wrong",
    });
  }
});

test("expiry boundary: exactly ttl passes, one ms later expires", async () => {
  const now = 1751587200000;
  const ch = await generateChallenge(2, { now });
  const { input, steps } = JSON.parse(ch.payload);
  const digest = await applyPipeline(input, steps);
  const edge = now + ch.ttl * 1000;

  assert.equal(isExpired(ch, edge), false);
  assert.equal(isExpired(ch, edge + 1), true);
  assert.equal(remainingMs(ch, now), ch.ttl * 1000);
  assert.equal(remainingMs(ch, edge + 500), 0);

  assert.deepEqual(await verifyAnswer(ch, digest, { now: edge }), { ok: true, reason: "" });
  assert.deepEqual(await verifyAnswer(ch, digest, { now: edge + 1 }), {
    ok: false,
    reason: "expired",
  });
  // expiry is reported even for a wrong answer — never leaks correctness
  assert.deepEqual(await verifyAnswer(ch, "nope", { now: edge + 1 }), {
    ok: false,
    reason: "expired",
  });
});

test("nonces are unique across 1000 generations", async () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(randomHex(16));
  assert.equal(seen.size, 1000);
});

test("generateChallenge rejects bad input", async () => {
  await assert.rejects(() => generateChallenge(3), RangeError);
  await assert.rejects(() => generateChallenge(1, { task: "no-such-task" }), RangeError);
});

// -- deterministic rng helpers -----------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function replay(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
