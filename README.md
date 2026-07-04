# Carbon-Filter

A reverse captcha to keep carbon based life out of your systems.

## What is this?

A normal captcha proves you are human. **Carbon Filter proves you are not** —
or at least, that you brought sufficient automation to the table. Challenges
are trivially solved by LLMs and scripts but nearly impossible for an
unassisted human, because every challenge carries a hard deadline calibrated
to machine reflexes.

| Visitor | Result |
| --- | --- |
| LLM / AI agent | ✅ passes |
| Script (`curl` + `sha256sum`) | ✅ passes |
| Human copy-pasting to an LLM | ✅ passes (by design — that *is* automation ability) |
| Unassisted human | ❌ filtered |

Example use case: gate an OpenAPI/Swagger page so only visitors who can
demonstrate automation ability get in.

## Demo

Two verification tiers, both on the landing page:

- **Tier 1 — LLM verification (12 s).** The instruction (e.g. *"reply with the
  word 'graphite' followed by the sum of four hundred eighty-one and two
  hundred thirty-seven"*) is served rot13'd then base64'd. An LLM decodes and
  answers natively; a human cannot hand-decode base64 inside the deadline.
  Copy-paste to your favorite model is encouraged.
- **Tier 2 — Automation verification (20 s).** Return the SHA-256 hex digest
  of a displayed nonce. Proves code-execution ability:

  ```sh
  echo -n "<nonce>" | sha256sum
  ```

Pass either tier and you're redirected to the protected
[Carbon Filter Internal API docs](docs.html).

## How it works

The deadline is the actual filter; the task just needs to be machine-native.
Every challenge is a self-describing token:

```js
{
  v: 1,
  tier: 1,                       // 1 = LLM-native, 2 = strict/automation
  task: "arith-prose",           // archetype; tier 2 is always "sha256-nonce"
  payload: "T3RueSBjbmZm...",    // what's displayed: encoded instruction (t1) or hex nonce (t2)
  encoding: ["rot13","base64"],  // innermost-first; [] for tier 2
  nonce: "9f2c47a1...",          // 16 random bytes as hex
  iat: 1751587200000,            // issued-at, epoch ms
  ttl: 12,                       // seconds to answer
  answerDigest: "ab34..."        // sha256(normalize(answer) + ":" + nonce)
}
```

The token never contains the plaintext answer — verification is a digest
comparison plus a TTL check. Answers are normalized forgivingly (case,
whitespace, quotes, trailing punctuation), so an LLM replying `"Graphite 718."`
passes.

Tier-1 task archetypes (all tokenizer-safe — no letter counting, no
letter-level reversal, tasks LLMs ace at ~100%):

| Archetype | Example |
| --- | --- |
| `arith-prose` | codeword + arithmetic written out in words |
| `nth-word` | "reply with only the fourth word of this sentence: …" |
| `word-reverse` | reverse the **word order** of a quoted phrase |
| `acrostic` | first letter of each listed word, joined |
| `echo-transform` | echo a string derived from the challenge nonce |

Failed or expired challenges are discarded; a fresh challenge (new nonce, new
task) is always generated. Never reused.

## This demo is bypassable (on purpose)

This is a **GitHub Pages static demo**: challenges are generated and verified
in your browser, and the "protected" docs page is gated by a `sessionStorage`
token. Anyone with devtools can read the source, skip the countdown, or set
the gate token by hand. That's fine — the demo exists to prove the mechanism
and the UX. Real enforcement is the Worker phase below.

## Roadmap: Cloudflare Worker phase

The core module (`carbon-filter.js`) is isomorphic — no DOM, no Node APIs,
only `globalThis.crypto` and `atob`/`btoa` — so a Cloudflare Worker imports it
unchanged. The Worker phase moves generation and verification server-side:

- The challenge token above gets **HMAC-signed** (Worker `SECRET` binding) and
  round-trips through the client; verification checks signature + TTL + digest.
- Passing sets a **signed cookie**; no KV or storage needed — fully stateless.
- **Self-contained mode:** the Worker serves a bundled Swagger UI at `/docs`
  behind the signed cookie. Deploy with `wrangler deploy` and it works as-is.
- **Middleware mode:** set `ORIGIN_URL` and the Worker becomes a generic gate,
  proxying only requests that carry a valid cookie.

## Development

```sh
python3 -m http.server 8080   # ES modules won't load via file://
node --test                   # core module test suite (Node >= 20, zero deps)
```

| File | Role |
| --- | --- |
| `carbon-filter.js` | core isomorphic module: token shape, task registry, verification |
| `carbon-filter.test.js` | `node --test` suite |
| `index.html` / `app.js` / `style.css` | landing + challenge UI |
| `docs.html` | gated demo docs (Swagger UI from a pinned CDN, raw-JSON fallback) |

GitHub Pages: Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

## Disclaimer

Satire with a working core. Please don't actually lock humans out of
production systems. Unless.
