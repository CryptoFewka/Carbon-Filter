// Carbon Filter — Cloudflare Worker.
//
// Server-enforced reverse captcha. Stateless: challenges round-trip through
// the client as HMAC-sealed tokens and passing sets an HMAC-sealed cookie, so
// no KV or storage is needed. Known trade-off (documented in the README): a
// solved challenge token can be replayed within its TTL window.
//
// Modes:
//  - Self-contained (default): gated demo docs at /docs.
//  - Middleware (env.ORIGIN_URL set): every path except / and /api/* is
//    proxied to ORIGIN_URL for visitors with a valid gate cookie.

import { generateChallenge, verifyAnswer } from "../carbon-filter.js";
import { sealToken, openToken } from "./sign.js";
import { challengePage, docsPage } from "./pages.js";

// Fallback so a fresh deploy works out of the box. Every response is flagged
// with x-carbon-filter-warning until a real secret is set:
//   wrangler secret put SECRET   (or let scripts/ensure-secret.mjs do it)
const DEMO_SECRET = "carbon-filter-insecure-demo-secret";

const GATE_COOKIE = "cf_gate";
const GATE_TTL_MS = 15 * 60 * 1000;

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function stripCookie(header, name) {
  return header
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${name}=`))
    .join("; ");
}

function gateCookieAttrs(url, maxAge) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

// Only same-origin absolute paths ("/x", not "//host" or full URLs).
function safeNext(next) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/docs";
}

async function readGate(request, secret) {
  const raw = getCookie(request, GATE_COOKIE);
  if (!raw) return null;
  const gate = await openToken(raw, secret);
  if (!gate || gate.v !== 1 || typeof gate.exp !== "number" || gate.exp < Date.now()) return null;
  return gate;
}

function html(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function denied(url, next) {
  const to = new URL("/", url);
  to.searchParams.set("denied", "1");
  to.searchParams.set("next", next);
  return Response.redirect(to.toString(), 302);
}

async function handle(request, env) {
  const url = new URL(request.url);
  const secret = env.SECRET || DEMO_SECRET;
  const { pathname } = url;

  if (pathname === "/") {
    return html(challengePage());
  }

  if (pathname === "/api/challenge" && request.method === "POST") {
    let tier = 1;
    try {
      const body = await request.json();
      tier = body.tier === 2 ? 2 : 1;
    } catch { /* default tier */ }
    const challenge = await generateChallenge(tier);
    return json({
      token: await sealToken(challenge, secret),
      payload: challenge.payload,
      tier: challenge.tier,
      ttl: challenge.ttl,
    });
  }

  if (pathname === "/api/verify" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, reason: "bad-request" }, { status: 400 });
    }
    const challenge = await openToken(body.token, secret);
    if (!challenge || challenge.v !== 1) {
      return json({ ok: false, reason: "bad-token" }, { status: 400 });
    }
    const result = await verifyAnswer(challenge, body.answer);
    if (!result.ok) return json(result);
    const now = Date.now();
    const gate = await sealToken({ v: 1, tier: challenge.tier, iat: now, exp: now + GATE_TTL_MS }, secret);
    return json(
      { ok: true, redirect: safeNext(body.next) },
      {
        headers: {
          "set-cookie": `${GATE_COOKIE}=${gate}${gateCookieAttrs(url, GATE_TTL_MS / 1000)}`,
        },
      },
    );
  }

  if (pathname === "/api/logout" && request.method === "POST") {
    return new Response(null, {
      status: 303,
      headers: {
        location: new URL("/", url).toString(),
        "set-cookie": `${GATE_COOKIE}=${gateCookieAttrs(url, 0)}`,
      },
    });
  }

  if (pathname.startsWith("/api/")) {
    return json({ ok: false, reason: "not-found" }, { status: 404 });
  }

  // Middleware mode: gate then proxy everything else to the origin.
  if (env.ORIGIN_URL) {
    const gate = await readGate(request, secret);
    if (!gate) return denied(url, pathname + url.search);
    const target = new URL(pathname + url.search, env.ORIGIN_URL);
    const headers = new Headers(request.headers);
    const cookies = stripCookie(headers.get("cookie") || "", GATE_COOKIE);
    if (cookies) headers.set("cookie", cookies);
    else headers.delete("cookie");
    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.arrayBuffer();
    }
    return fetch(target, init);
  }

  // Self-contained mode: the gated demo docs.
  if (pathname === "/docs") {
    const gate = await readGate(request, secret);
    if (!gate) return denied(url, "/docs");
    return html(docsPage(gate.tier));
  }

  return html("<h1>404</h1><p>Nothing here. The interesting things are gated.</p>", { status: 404 });
}

export default {
  async fetch(request, env = {}) {
    const response = await handle(request, env);
    if (!env.SECRET) {
      // Response.redirect() produces immutable headers — clone before flagging.
      const flagged = new Response(response.body, response);
      flagged.headers.set("x-carbon-filter-warning", "insecure-demo-secret");
      return flagged;
    }
    return response;
  },
};
