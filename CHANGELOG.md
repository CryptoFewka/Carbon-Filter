# Changelog

All notable changes to Carbon Filter are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-07-04

First stable release. Carbon-based life remains filtered.

### Added

- **Core module** (`carbon-filter.js`): isomorphic, zero-runtime-dependency
  challenge engine shared verbatim by the browser demo and the Cloudflare
  Worker. Self-describing challenge tokens carry only an answer digest —
  never the plaintext answer; verification is a SHA-256 digest comparison
  plus a TTL check, with forgiving answer normalization.
- **Tier 1 — LLM verification (12 s):** instructions served rot13'd then
  base64'd, across five tokenizer-safe task archetypes (`arith-prose`,
  `nth-word`, `word-reverse`, `acrostic`, `echo-transform`).
- **Tier 2 — Automation verification (20 s):** return the SHA-256 hex digest
  of a displayed nonce.
- **Static demo** (GitHub Pages): landing + challenge UI with countdown, and
  a `sessionStorage`-gated Swagger docs page — bypassable by design.
- **Cloudflare Worker** (`worker/`): fully stateless server-side enforcement.
  Challenge tokens and the 15-minute `HttpOnly` gate cookie are
  HMAC-SHA256-sealed with the `SECRET` binding; deadlines checked against the
  server clock. Self-contained mode (serves challenge + docs) and middleware
  mode (`ORIGIN_URL` proxying for gated visitors, gate cookie stripped before
  forwarding).
- **One-click deploy** via the Deploy to Cloudflare button, with
  `scripts/ensure-secret.mjs` provisioning a random `SECRET` on first deploy.
- **Test suite:** core + Worker integration tests on plain `node --test`,
  including a reference "silicon lifeform" solver that answers every tier-1
  archetype.

[Unreleased]: https://github.com/CryptoFewka/Carbon-Filter/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/CryptoFewka/Carbon-Filter/releases/tag/v1.0.0
