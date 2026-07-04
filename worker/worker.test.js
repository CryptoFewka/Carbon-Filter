import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import worker from "./index.js";
import { sealToken, openToken } from "./sign.js";
import { decodePayload, numberToWords, sha256Hex } from "../carbon-filter.js";

const SECRET = "test-secret";
const BASE = "https://filter.example";

const jsonReq = (path, body, extra = {}) =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extra.headers },
    body: JSON.stringify(body),
  });

const getReq = (path, headers = {}) => new Request(`${BASE}${path}`, { headers });

function gateCookie(res) {
  const set = res.headers.get("set-cookie");
  assert.ok(set, "expected a set-cookie header");
  return set.split(";")[0];
}

// --- the silicon lifeform: solves any tier-1 instruction -------------------

const WORDS_TO_NUM = new Map();
for (let n = 0; n <= 999; n++) WORDS_TO_NUM.set(numberToWords(n), n);

function solve(instruction) {
  let m;
  if ((m = instruction.match(/^Reply with the text "(.+)" in uppercase\.$/)))
    return m[1].toUpperCase();
  if ((m = instruction.match(/joined into one lowercase string: (.+)\.$/)))
    return m[1].split(/\s+/).map((w) => w[0].toLowerCase()).join("");
  if ((m = instruction.match(/words in reverse order: "(.+)"\.$/)))
    return m[1].split(/\s+/).reverse().join(" ");
  if ((m = instruction.match(/^Reply with only the (third|fourth|fifth|sixth) word of this sentence: "(.+)"\.$/)))
    return m[2].split(/\s+/)[{ third: 2, fourth: 3, fifth: 4, sixth: 5 }[m[1]]];
  if ((m = instruction.match(/^Reply with the word "(\w+)" followed by a space and the sum of (.+) and (.+)\.$/)))
    return `${m[1]} ${WORDS_TO_NUM.get(m[2]) + WORDS_TO_NUM.get(m[3])}`;
  if ((m = instruction.match(/^Reply with the word "(\w+)" followed by a space and the result of (.+) minus (.+)\.$/)))
    return `${m[1]} ${WORDS_TO_NUM.get(m[2]) - WORDS_TO_NUM.get(m[3])}`;
  throw new Error(`unsolvable instruction: ${instruction}`);
}

// --- sign.js ----------------------------------------------------------------

test("sealToken/openToken round-trip and tamper resistance", async () => {
  const obj = { v: 1, hello: "world", n: 42 };
  const token = await sealToken(obj, SECRET);
  assert.deepEqual(await openToken(token, SECRET), obj);
  assert.equal(await openToken(token, "other-secret"), null);
  const [payload, mac] = token.split(".");
  assert.equal(await openToken(`${payload}x.${mac}`, SECRET), null);
  assert.equal(await openToken(`${payload}.${mac.slice(0, -2)}aa`, SECRET), null);
  assert.equal(await openToken("garbage", SECRET), null);
  assert.equal(await openToken(null, SECRET), null);
});

// --- basic pages and secret warning ------------------------------------------

test("GET / serves the challenge page", async () => {
  const res = await worker.fetch(getReq("/"), { SECRET });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /CARBON FILTER/);
  assert.equal(res.headers.get("x-carbon-filter-warning"), null);
});

test("missing SECRET flags every response with a warning header", async () => {
  const res = await worker.fetch(getReq("/"), {});
  assert.equal(res.headers.get("x-carbon-filter-warning"), "insecure-demo-secret");
});

test("unknown paths 404 in self-contained mode", async () => {
  const res = await worker.fetch(getReq("/nope"), { SECRET });
  assert.equal(res.status, 404);
});

// --- challenge / verify round trips -----------------------------------------

test("tier 2 round trip: challenge -> digest -> cookie -> /docs", async () => {
  const chRes = await worker.fetch(jsonReq("/api/challenge", { tier: 2 }), { SECRET });
  const ch = await chRes.json();
  assert.equal(ch.tier, 2);
  assert.match(ch.payload, /^[0-9a-f]{32}$/);

  const answer = await sha256Hex(ch.payload);
  const vRes = await worker.fetch(jsonReq("/api/verify", { token: ch.token, answer }), { SECRET });
  const v = await vRes.json();
  assert.deepEqual(v, { ok: true, redirect: "/docs" });
  const cookie = gateCookie(vRes);
  assert.match(vRes.headers.get("set-cookie"), /HttpOnly/);
  assert.match(vRes.headers.get("set-cookie"), /Secure/); // https request URL

  const docsRes = await worker.fetch(getReq("/docs", { cookie }), { SECRET });
  assert.equal(docsRes.status, 200);
  assert.match(await docsRes.text(), /tier 2 verified/);
});

test("tier 1 round trip for 10 random challenges", async () => {
  for (let i = 0; i < 10; i++) {
    const ch = await (await worker.fetch(jsonReq("/api/challenge", { tier: 1 }), { SECRET })).json();
    const instruction = decodePayload(ch.payload, ["rot13", "base64"]);
    const vRes = await worker.fetch(
      jsonReq("/api/verify", { token: ch.token, answer: solve(instruction), next: "/docs" }),
      { SECRET },
    );
    assert.deepEqual(await vRes.json(), { ok: true, redirect: "/docs" });
  }
});

test("wrong answer fails; tampered token is rejected", async () => {
  const ch = await (await worker.fetch(jsonReq("/api/challenge", { tier: 2 }), { SECRET })).json();
  const wrong = await worker.fetch(jsonReq("/api/verify", { token: ch.token, answer: "nope" }), { SECRET });
  assert.deepEqual(await wrong.json(), { ok: false, reason: "wrong" });

  const tampered = await worker.fetch(
    jsonReq("/api/verify", { token: ch.token.slice(0, -3) + "abc", answer: "x" }),
    { SECRET },
  );
  assert.equal(tampered.status, 400);
  assert.deepEqual(await tampered.json(), { ok: false, reason: "bad-token" });
});

test("next is sanitized against open redirects", async () => {
  for (const next of ["//evil.example", "https://evil.example", 42, null]) {
    const ch = await (await worker.fetch(jsonReq("/api/challenge", { tier: 2 }), { SECRET })).json();
    const answer = await sha256Hex(ch.payload);
    const v = await (await worker.fetch(jsonReq("/api/verify", { token: ch.token, answer, next }), { SECRET })).json();
    assert.equal(v.redirect, "/docs");
  }
  const ch = await (await worker.fetch(jsonReq("/api/challenge", { tier: 2 }), { SECRET })).json();
  const answer = await sha256Hex(ch.payload);
  const v = await (await worker.fetch(jsonReq("/api/verify", { token: ch.token, answer, next: "/deep/path?x=1" }), { SECRET })).json();
  assert.equal(v.redirect, "/deep/path?x=1");
});

test("a solved token can be replayed within its TTL (documented limitation)", async () => {
  const ch = await (await worker.fetch(jsonReq("/api/challenge", { tier: 2 }), { SECRET })).json();
  const answer = await sha256Hex(ch.payload);
  for (let i = 0; i < 2; i++) {
    const v = await (await worker.fetch(jsonReq("/api/verify", { token: ch.token, answer }), { SECRET })).json();
    assert.equal(v.ok, true);
  }
});

// --- gate cookie ---------------------------------------------------------------

test("/docs without or with a bad cookie redirects to /?denied=1", async () => {
  for (const headers of [{}, { cookie: "cf_gate=garbage.mac" }]) {
    const res = await worker.fetch(getReq("/docs", headers), { SECRET });
    assert.equal(res.status, 302);
    const to = new URL(res.headers.get("location"));
    assert.equal(to.pathname, "/");
    assert.equal(to.searchParams.get("denied"), "1");
    assert.equal(to.searchParams.get("next"), "/docs");
  }
});

test("an expired gate cookie is rejected", async () => {
  const expired = await sealToken({ v: 1, tier: 2, iat: 0, exp: Date.now() - 1000 }, SECRET);
  const res = await worker.fetch(getReq("/docs", { cookie: `cf_gate=${expired}` }), { SECRET });
  assert.equal(res.status, 302);
});

test("logout clears the cookie and redirects home", async () => {
  const res = await worker.fetch(new Request(`${BASE}/api/logout`, { method: "POST" }), { SECRET });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("set-cookie"), /^cf_gate=; Max-Age=0/);
});

// --- middleware (proxy) mode -----------------------------------------------------

test("middleware mode gates and proxies to ORIGIN_URL, stripping cf_gate", async (t) => {
  const hits = [];
  const origin = http.createServer((req, res) => {
    hits.push({ url: req.url, method: req.method, cookie: req.headers.cookie ?? null });
    res.setHeader("x-origin", "yes");
    res.end("origin says hi");
  });
  await new Promise((resolve) => origin.listen(0, "127.0.0.1", resolve));
  t.after(() => origin.close());
  const env = { SECRET, ORIGIN_URL: `http://127.0.0.1:${origin.address().port}` };

  // Ungated → bounced to the challenge page, origin never touched.
  const bounced = await worker.fetch(getReq("/openapi.json?full=1"), env);
  assert.equal(bounced.status, 302);
  assert.equal(new URL(bounced.headers.get("location")).searchParams.get("next"), "/openapi.json?full=1");
  assert.equal(hits.length, 0);

  // Gated → proxied through, cf_gate stripped, other cookies preserved.
  const ch = await (await worker.fetch(jsonReq("/api/challenge", { tier: 2 }), env)).json();
  const vRes = await worker.fetch(
    jsonReq("/api/verify", { token: ch.token, answer: await sha256Hex(ch.payload) }),
    env,
  );
  const cookie = gateCookie(vRes);
  const proxied = await worker.fetch(
    getReq("/openapi.json?full=1", { cookie: `${cookie}; theme=dark` }),
    env,
  );
  assert.equal(proxied.status, 200);
  assert.equal(await proxied.text(), "origin says hi");
  assert.equal(proxied.headers.get("x-origin"), "yes");
  assert.deepEqual(hits, [{ url: "/openapi.json?full=1", method: "GET", cookie: "theme=dark" }]);

  // POST bodies are forwarded.
  const post = await worker.fetch(
    new Request(`${BASE}/submit`, { method: "POST", headers: { cookie }, body: "hello" }),
    env,
  );
  assert.equal(post.status, 200);
  assert.equal(hits[1].method, "POST");

  // The challenge page itself stays reachable in middleware mode.
  const home = await worker.fetch(getReq("/"), env);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /CARBON FILTER/);
});
