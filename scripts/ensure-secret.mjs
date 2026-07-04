// Ensures the Worker has a SECRET set, generating a random one on first run.
//
// Intended as a post-deploy step in Cloudflare Workers Builds:
//   npx wrangler deploy --env production && node scripts/ensure-secret.mjs production
//
// Never fails the build: if the build environment's API token can't manage
// secrets, it prints instructions and exits 0 — the Worker keeps running on
// its baked-in demo secret (flagged via x-carbon-filter-warning) until
// `wrangler secret put SECRET` is run manually once.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const env = process.argv[2];
const envArgs = env ? ["--env", env] : [];
const wrangler = (args, input) =>
  execFileSync("npx", ["wrangler", ...args, ...envArgs], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

try {
  // `wrangler secret list` prints a JSON array of {name, type} entries.
  const list = wrangler(["secret", "list"]);
  if (list.includes('"SECRET"')) {
    console.log("ensure-secret: SECRET already set, nothing to do.");
    process.exit(0);
  }
  wrangler(["secret", "put", "SECRET"], randomBytes(32).toString("hex"));
  console.log("ensure-secret: generated and stored a random SECRET.");
} catch (err) {
  console.warn(
    [
      "ensure-secret: could not verify or set SECRET (non-fatal).",
      `  ${String(err.message || err).split("\n")[0]}`,
      "  The Worker will run with the insecure demo secret (see the",
      "  x-carbon-filter-warning response header) until you run:",
      `    npx wrangler secret put SECRET${env ? ` --env ${env}` : ""}`,
    ].join("\n"),
  );
  process.exit(0);
}
