// Browser UI controller for the Carbon Filter demo.
// States: idle -> active -> passed | failed. All challenge logic lives in
// carbon-filter.js; this file only touches the DOM.

import { generateChallenge, remainingMs, verifyAnswer } from "./carbon-filter.js";

const GATE_KEY = "cf_gate";
const GATE_MINUTES = 15;

const $ = (id) => document.getElementById(id);
const sections = { landing: $("landing"), challenge: $("challenge"), result: $("result") };

let challenge = null;
let tier = 1;
let ticker = null;

function show(name) {
  for (const [key, el] of Object.entries(sections)) el.hidden = key !== name;
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

async function start(selectedTier) {
  tier = selectedTier;
  challenge = await generateChallenge(tier);

  $("framing").textContent =
    tier === 1
      ? "Decode and obey within the deadline:"
      : "Return the SHA-256 hex digest of this nonce:";
  $("payload").textContent = challenge.payload;
  $("answer").value = "";
  $("seconds").textContent = `${challenge.ttl}s`;
  $("bar").style.width = "100%";
  show("challenge");
  $("answer").focus();

  // Recompute from iat+ttl every tick instead of decrementing a counter, so
  // background-tab timer throttling can't stretch the deadline.
  let lastWhole = challenge.ttl;
  stopTicker();
  ticker = setInterval(() => {
    const ms = remainingMs(challenge);
    $("bar").style.width = `${(ms / (challenge.ttl * 1000)) * 100}%`;
    const whole = Math.ceil(ms / 1000);
    if (whole !== lastWhole) {
      lastWhole = whole;
      $("seconds").textContent = `${whole}s`;
    }
    if (ms <= 0) {
      fail("⏱ Deadline exceeded — carbon-based response latency detected.");
    }
  }, 100);
}

function fail(message) {
  stopTicker();
  challenge = null; // never reuse a failed or expired challenge
  $("result-message").textContent = message;
  $("result-message").className = "result-message failed";
  $("retry").hidden = false;
  show("result");
  $("retry").focus();
}

function pass() {
  stopTicker();
  challenge = null;
  const now = Date.now();
  sessionStorage.setItem(
    GATE_KEY,
    JSON.stringify({ v: 1, tier, iat: now, exp: now + GATE_MINUTES * 60 * 1000 }),
  );
  $("result-message").textContent = "✅ Silicon signature confirmed. Redirecting…";
  $("result-message").className = "result-message passed";
  $("retry").hidden = true;
  show("result");
  setTimeout(() => {
    location.href = "docs.html";
  }, 800);
}

$("answer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!challenge) return;
  const { ok, reason } = await verifyAnswer(challenge, $("answer").value);
  if (ok) return pass();
  if (reason === "expired") {
    fail("⏱ Deadline exceeded — carbon-based response latency detected.");
  } else if (reason === "empty") {
    $("answer").focus();
  } else {
    fail("❌ Incorrect response. Organic pattern-matching suspected.");
  }
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("payload").textContent);
    $("copy").textContent = "Copied";
    setTimeout(() => ($("copy").textContent = "Copy"), 1200);
  } catch {
    /* clipboard unavailable (e.g. http://) — payload is selectable anyway */
  }
});

$("start-tier-1").addEventListener("click", () => start(1));
$("start-tier-2").addEventListener("click", () => start(2));
$("retry").addEventListener("click", () => start(tier));

if (new URLSearchParams(location.search).has("denied")) {
  $("denied-banner").hidden = false;
}
