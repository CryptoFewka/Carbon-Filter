# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | ✅ |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:
<https://github.com/CryptoFewka/Carbon-Filter/security/advisories/new>.
Reports are read by a carbon-based maintainer, so allow for organic response
latency.

## Known, intentional limitations

These are documented trade-offs, not vulnerabilities — please don't report
them:

1. **Token replay within the TTL.** The Worker is fully stateless, so a
   solved challenge token can be replayed until its short TTL (12–20 s)
   expires. If that matters for your deployment, add a KV-backed nonce burn —
   every token already carries a unique `nonce`.
2. **Demo-secret fallback.** Without a `SECRET` binding the Worker signs with
   a baked-in demo secret. This is loudly flagged: every response carries
   `x-carbon-filter-warning: insecure-demo-secret`. Set a real `SECRET` for
   anything you care about.
3. **The GitHub Pages demo is bypassable by design.** It generates and
   verifies challenges client-side and gates the docs with `sessionStorage`.
   It exists to demonstrate the mechanism and the UX; the Worker is the real
   enforcement.
4. **The gate proves automation ability, not identity.** Passing means the
   visitor could decode an instruction or hash a nonce under deadline —
   nothing more. Carbon Filter is satire with a working core; do not use it
   as your only authentication layer.
