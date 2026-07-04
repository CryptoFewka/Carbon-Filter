// HTML for the Worker's challenge and docs pages, as template strings so the
// Worker stays bundler-free and importable by plain `node --test`.

import { OPENAPI_SPEC } from "../openapi-spec.js";

const STYLE = `
  :root { --bg:#0a0e0c; --panel:#101614; --ink:#c8e6d0; --dim:#6f8f7c; --accent:#3ddc84; --danger:#ff5f56; --border:#1e2a24; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; color:var(--ink); display:flex; justify-content:center; padding:2rem 1rem;
    background: repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.18) 2px 4px), var(--bg);
    font-family: "SFMono-Regular", ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; }
  .shell { width:100%; max-width:44rem; }
  h1 { margin:0; font-size:2rem; letter-spacing:0.35em; color:var(--accent); text-shadow:0 0 12px rgba(61,220,132,0.35); }
  .tagline { color:var(--dim); margin-top:0.4rem; }
  section, .banner { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:1.25rem 1.5rem; margin-top:1.25rem; }
  .banner { border-color:var(--danger); color:var(--danger); }
  .tier-buttons { display:grid; gap:0.75rem; margin:1rem 0; }
  button { font:inherit; color:var(--ink); background:#16211c; border:1px solid var(--border); border-radius:6px; padding:0.6rem 1rem; cursor:pointer; text-align:left; }
  button:hover { border-color:var(--accent); }
  button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .tier { display:grid; gap:0.25rem; }
  .tier-name { color:var(--accent); font-weight:bold; }
  .tier-detail { color:var(--dim); font-size:0.85rem; }
  .footnote { color:var(--dim); font-size:0.8rem; }
  .footnote a { color:var(--accent); }
  .framing { margin-top:0; }
  .payload-wrap { position:relative; }
  .payload { background:#0c1210; border:1px dashed var(--dim); border-radius:6px; padding:1rem 4.5rem 1rem 1rem; overflow-x:auto; white-space:pre-wrap; word-break:break-all; user-select:all; }
  #copy { position:absolute; top:0.5rem; right:0.5rem; padding:0.25rem 0.6rem; font-size:0.8rem; }
  .countdown { display:flex; align-items:center; gap:0.75rem; margin:1rem 0; }
  .bar-track { flex:1; height:6px; background:#0c1210; border-radius:3px; overflow:hidden; }
  .bar { height:100%; width:100%; background:var(--accent); transition:width 100ms linear; }
  @media (prefers-reduced-motion: reduce) { .bar { transition:none; } }
  .seconds { min-width:3ch; text-align:right; color:var(--accent); }
  #answer-form { display:flex; gap:0.6rem; }
  #answer { flex:1; font:inherit; color:var(--ink); background:#0c1210; border:1px solid var(--border); border-radius:6px; padding:0.6rem 0.8rem; }
  #answer:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  .result-message { font-size:1.05rem; margin-top:0; }
  .result-message.passed { color:var(--accent); }
  .result-message.failed { color:var(--danger); }
  footer { margin-top:1rem; text-align:center; }
`;

const CHALLENGE_SCRIPT = `
  const $ = (id) => document.getElementById(id);
  const sections = { landing: $("landing"), challenge: $("challenge"), result: $("result") };
  const params = new URLSearchParams(location.search);
  const next = params.get("next") || "";
  let state = null; // { token, deadline, ttlMs }
  let ticker = null;
  let tier = 1;

  if (params.has("denied")) $("denied-banner").hidden = false;

  function show(name) {
    for (const [key, el] of Object.entries(sections)) el.hidden = key !== name;
  }

  async function start(selectedTier) {
    tier = selectedTier;
    const res = await fetch("/api/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    const ch = await res.json();
    state = { token: ch.token, ttlMs: ch.ttl * 1000, deadline: Date.now() + ch.ttl * 1000 };
    $("framing").textContent = tier === 1
      ? "Decode and obey within the deadline:"
      : "Return the SHA-256 hex digest of this nonce:";
    $("payload").textContent = ch.payload;
    $("answer").value = "";
    $("seconds").textContent = ch.ttl + "s";
    $("bar").style.width = "100%";
    show("challenge");
    $("answer").focus();
    clearInterval(ticker);
    ticker = setInterval(() => {
      const ms = Math.max(0, state.deadline - Date.now());
      $("bar").style.width = (ms / state.ttlMs) * 100 + "%";
      $("seconds").textContent = Math.ceil(ms / 1000) + "s";
      if (ms <= 0) fail("\\u23f1 Deadline exceeded \\u2014 carbon-based response latency detected.");
    }, 100);
  }

  function fail(message) {
    clearInterval(ticker);
    state = null;
    $("result-message").textContent = message;
    $("result-message").className = "result-message failed";
    $("retry").hidden = false;
    show("result");
    $("retry").focus();
  }

  $("answer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state) return;
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: state.token, answer: $("answer").value, next }),
    });
    const out = await res.json();
    if (out.ok) {
      clearInterval(ticker);
      state = null;
      $("result-message").textContent = "\\u2705 Silicon signature confirmed. Redirecting\\u2026";
      $("result-message").className = "result-message passed";
      $("retry").hidden = true;
      show("result");
      setTimeout(() => { location.href = out.redirect; }, 800);
    } else if (out.reason === "expired") {
      fail("\\u23f1 Deadline exceeded \\u2014 carbon-based response latency detected.");
    } else if (out.reason === "empty") {
      $("answer").focus();
    } else {
      fail("\\u274c Incorrect response. Organic pattern-matching suspected.");
    }
  });

  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("payload").textContent);
      $("copy").textContent = "Copied";
      setTimeout(() => ($("copy").textContent = "Copy"), 1200);
    } catch { /* payload is selectable anyway */ }
  });

  $("start-tier-1").addEventListener("click", () => start(1));
  $("start-tier-2").addEventListener("click", () => start(2));
  $("retry").addEventListener("click", () => start(tier));
`;

export function challengePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Carbon Filter — reverse captcha</title>
  <style>${STYLE}</style>
</head>
<body>
  <main class="shell">
    <header>
      <h1>CARBON FILTER</h1>
      <p class="tagline">A reverse captcha to keep carbon-based life out of your systems.</p>
    </header>
    <div id="denied-banner" class="banner" hidden>
      ⛔ Verification required. Pass a challenge to access the protected content.
    </div>
    <section id="landing">
      <p>Prove you are <em>not</em> carbon-based. Pick a verification tier. You will be given a
      challenge and a deadline calibrated to machine reflexes. The deadline is enforced
      server-side.</p>
      <div class="tier-buttons">
        <button id="start-tier-1" class="tier">
          <span class="tier-name">Tier 1 — LLM verification</span>
          <span class="tier-detail">Decode an instruction and obey it. 12 seconds.</span>
        </button>
        <button id="start-tier-2" class="tier">
          <span class="tier-name">Tier 2 — Automation verification</span>
          <span class="tier-detail">Return the SHA-256 hex digest of a nonce. 20 seconds.</span>
        </button>
      </div>
      <p class="footnote">Humans assisted by an AI are welcome — copy-paste is encouraged.
      Unassisted humans will not make it.</p>
    </section>
    <section id="challenge" hidden>
      <p id="framing" class="framing"></p>
      <div class="payload-wrap">
        <pre id="payload" class="payload" aria-label="challenge payload"></pre>
        <button id="copy" type="button" title="Copy payload">Copy</button>
      </div>
      <div class="countdown">
        <div class="bar-track"><div id="bar" class="bar"></div></div>
        <span id="seconds" class="seconds" aria-live="polite"></span>
      </div>
      <form id="answer-form">
        <input id="answer" type="text" autocomplete="off" spellcheck="false"
               placeholder="response" aria-label="challenge response">
        <button type="submit">Submit</button>
      </form>
    </section>
    <section id="result" hidden>
      <p id="result-message" class="result-message"></p>
      <button id="retry" hidden>New challenge</button>
    </section>
    <footer>
      <p class="footnote">Server-enforced by a Cloudflare Worker — see the
      <a href="https://github.com/CryptoFewka/Carbon-Filter#readme">README</a> to deploy your own.</p>
    </footer>
  </main>
  <script>${CHALLENGE_SCRIPT}</script>
</body>
</html>`;
}

export function docsPage(tier) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Carbon Filter Internal API — protected docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css">
  <style>
    body { margin:0; font-family:sans-serif; background:#fafafa; }
    .cf-header { display:flex; align-items:center; gap:1rem; padding:0.6rem 1rem; background:#0a0e0c;
      color:#3ddc84; font-family:ui-monospace, Menlo, Consolas, monospace; }
    .cf-header .note { color:#6f8f7c; font-size:0.8rem; flex:1; }
    .cf-header button { font:inherit; color:#c8e6d0; background:#16211c; border:1px solid #1e2a24;
      border-radius:6px; padding:0.3rem 0.8rem; cursor:pointer; }
    #fallback { padding:1rem; overflow-x:auto; }
  </style>
</head>
<body>
  <div class="cf-header">
    <strong>CARBON FILTER</strong>
    <span>tier ${Number(tier) || "?"} verified</span>
    <span class="note">Server-enforced gate — signed cookie, verified on every request.</span>
    <form method="post" action="/api/logout" style="margin:0"><button>Log out</button></form>
  </div>
  <div id="swagger"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    const spec = ${JSON.stringify(OPENAPI_SPEC)};
    if (window.SwaggerUIBundle) {
      SwaggerUIBundle({ spec, dom_id: "#swagger" });
    } else {
      const pre = document.createElement("pre");
      pre.id = "fallback";
      pre.textContent = JSON.stringify(spec, null, 2);
      document.getElementById("swagger").replaceWith(pre);
    }
  </script>
</body>
</html>`;
}
