# Contributing

Contributions from silicon and carbon-based life are both welcome — the
latter presumably with assistance.

## Setup

```sh
bun install                   # bun.lock is the committed lockfile
node --test                   # core + worker test suite (Node >= 20)
python3 -m http.server 8080   # serve the static demo (ES modules won't load via file://)
bunx wrangler dev             # run the Worker locally
```

For local Worker secrets, copy `.dev.vars.example` to `.dev.vars`.

## Ground rules

- **Zero runtime dependencies is a feature, not an accident.** The core, the
  demo, and the Worker must keep working with nothing installed. `wrangler`
  stays the only devDependency; the test suite must run on plain
  `node --test` with no install step (CI relies on this).
- **`carbon-filter.js` must stay isomorphic.** It runs verbatim in browsers,
  Node >= 20, and Cloudflare Workers, so it may only use `globalThis.crypto`
  and `atob`/`btoa` — no imports, no Node-only APIs, no build step.
- **New tier-1 archetypes must be tokenizer-safe and passage-scale.** Tasks
  LLMs solve at ~100%: no letter counting, no letter-level reversal. And
  tasks a human cannot finish inside the deadline even after running the
  payload through a decode one-liner — bury the question in ~100 words of
  distractor prose or require semantic knowledge. Add the archetype to
  `TASKS` in `carbon-filter.js`, teach the reference solver in
  `worker/worker.test.js` to answer it, and extend the repeated-generation
  tests in `carbon-filter.test.js` (the existing pattern generates each
  archetype ~50 times and verifies every instance).
- **Don't break the API shapes.** `worker/worker.test.js` asserts the exact
  JSON responses of `/api/challenge` and `/api/verify`; treat them as a
  public contract.

## Pull requests

- `node --test` must pass (CI runs it on Node 20/22/24, plus a
  `wrangler deploy --dry-run` config check).
- Match the existing style: vanilla ES modules, no formatter, comments only
  where the code can't speak for itself.
- Keep the voice. Error messages, docs, and UI copy are deadpan sci-fi;
  exclamation points are for humans.

## Regenerating visual assets

`assets/logo.svg` and `assets/favicon.svg` are hand-written — edit the SVG
directly. The favicon is also inlined as a base64 data URI in
`worker/pages.js` (the Worker routes only `/`, `/docs`, and `/api/*`, so it
can't serve a favicon file); after editing `assets/favicon.svg`, refresh the
inline copy:

```sh
base64 -w0 assets/favicon.svg   # paste into FAVICON in worker/pages.js
```

`assets/og.png` (the 1200×630 social preview) is a screenshot of
`assets/og-template.html`:

```sh
npx playwright screenshot --viewport-size=1200,630 assets/og-template.html assets/og.png
```

README screenshots in `assets/screenshots/` are captures of the static demo
served locally, taken at a 1000×720 viewport with `deviceScaleFactor: 2`.
