# Carbon-Filter

A reverse captcha to keep carbon based life out of your systems.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/CryptoFewka/Carbon-Filter)

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

## Live demos

- **Cloudflare Worker (server-enforced):** <https://carbon-filter.without.support>
- **GitHub Pages (client-side demo):** <https://cryptofewka.github.io/Carbon-Filter/>

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

Pass either tier and you're redirected to the protected Carbon Filter
Internal API docs.

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

The core logic lives in a single isomorphic, zero-dependency module —
[`carbon-filter.js`](carbon-filter.js) — shared verbatim by the browser demo
and the Cloudflare Worker.

## The Cloudflare Worker (real enforcement)

The Worker version moves generation and verification server-side. It is fully
stateless — no KV, no database:

- `POST /api/challenge` issues a challenge whose full token (including the
  answer digest) is **HMAC-SHA256-sealed** with the `SECRET` binding, then
  round-trips through the client.
- `POST /api/verify` re-opens the token (any tampering → rejected), checks the
  deadline against the **server clock**, and compares the answer digest. Devtools
  can't help you here.
- Passing sets a sealed, `HttpOnly` **gate cookie** (15 minutes). Every gated
  request re-verifies it.

Two modes:

- **Self-contained (default):** the Worker serves the challenge at `/` and the
  protected Swagger docs at `/docs`. Works out of the box.
- **Middleware:** set the `ORIGIN_URL` variable and the Worker becomes a
  generic gate — every path except `/` and `/api/*` is proxied to your origin
  only for visitors holding a valid gate cookie (the gate cookie is stripped
  before forwarding). Point it at your real Swagger host and you're done.

Known trade-off of statelessness: a solved challenge token can be replayed
within its short TTL window. If that matters to you, add a KV-backed
nonce-burn — the token already carries a unique `nonce`.

### Deploy your own

Click the **Deploy to Cloudflare** button above — you'll be prompted for a
`SECRET` (any long random string). Or manually:

```sh
npm install
npx wrangler deploy                 # deploys to <name>.<account>.workers.dev
npx wrangler secret put SECRET      # paste something like `openssl rand -hex 32`
```

Without a `SECRET` the Worker still works but signs with a baked-in demo
secret and flags every response with
`x-carbon-filter-warning: insecure-demo-secret`.

### How the canonical demo deploys

The demo at `carbon-filter.without.support` uses [Workers
Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) watching this
repo, with the custom domain kept in the `production` wrangler environment so
that button/manual deploys stay portable. Dashboard build configuration:

| Setting | Value |
| --- | --- |
| Production branch (`main`) deploy command | `npx wrangler deploy --env production && node scripts/ensure-secret.mjs production` |
| Non-production branch deploy command | `npx wrangler versions upload --env production` (preview URLs) |

[`scripts/ensure-secret.mjs`](scripts/ensure-secret.mjs) generates a random
`SECRET` on the first deploy and is a no-op afterwards; if the build token
can't manage secrets it just prints the manual command and never fails the
build.

## The GitHub Pages demo is bypassable (on purpose)

The static demo generates and verifies challenges in your browser, and the
"protected" docs page is gated by a `sessionStorage` token. Anyone with
devtools can skip it. It exists to prove the mechanism and the UX; the Worker
is the real thing.

## Development

```sh
node --test                   # core + worker test suite (Node >= 20, zero runtime deps)
python3 -m http.server 8080   # serve the static demo (ES modules won't load via file://)
npx wrangler dev              # run the Worker locally
```

| File | Role |
| --- | --- |
| `carbon-filter.js` | core isomorphic module: token shape, task registry, verification |
| `carbon-filter.test.js` | core test suite |
| `index.html` / `app.js` / `style.css` | static demo: landing + challenge UI |
| `docs.html` / `openapi-spec.js` | static demo: gated docs + the shared fake OpenAPI spec |
| `worker/index.js` | Worker: routes, cookie gate, proxy mode |
| `worker/sign.js` | HMAC sealing for tokens and cookies |
| `worker/pages.js` | Worker-served challenge + docs pages |
| `worker/worker.test.js` | request-level Worker integration tests (plain `node --test`) |
| `wrangler.jsonc` | Worker config: portable default env + `production` (custom domain) |
| `scripts/ensure-secret.mjs` | one-time random `SECRET` provisioning after deploy |

GitHub Pages: Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

## Disclaimer

Satire with a working core. Please don't actually lock humans out of
production systems. Unless.
