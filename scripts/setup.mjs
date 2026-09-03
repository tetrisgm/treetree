#!/usr/bin/env node
/** Provision a new family archive: D1, R2, wrangler config, session secret.
 *
 * Non-interactive by design so a coding agent can run it (AGENTS.md):
 *
 *   node scripts/setup.mjs --name smith-tree --owner you@example.com \
 *     --archive-name Smith [--tagline "..."] [--origin https://...]
 *
 * It creates the database and bucket (reusing them if they already exist),
 * rewrites wrangler.jsonc for this deployment, sets AUTH_SESSION_SECRET,
 * and prints the steps that need a human (OAuth consoles).
 */
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index].startsWith("--")) fail(`Unexpected argument: ${process.argv[index]}`);
  args.set(process.argv[index].slice(2), process.argv[index + 1]);
}
function fail(message) { console.error(`setup: ${message}`); process.exit(1); }

const name = args.get("name");
const owner = args.get("owner");
const archiveName = args.get("archive-name");
if (!name || !owner || !archiveName) fail("required: --name <worker-name> --owner <email> --archive-name <family name>");
if (!/^[a-z0-9-]{3,54}$/.test(name)) fail("--name must be a lowercase-hyphen worker name");
if (!owner.includes("@")) fail("--owner must be an email address");

const wrangler = (...cliArgs) => execFileSync("npx", ["wrangler", ...cliArgs], { encoding: "utf8" });

console.log(`Signed in to Cloudflare as: ${wrangler("whoami").split("\n").find((line) => line.includes("associated with")) ?? "(run npx wrangler login first)"}`);

// D1: create or reuse by name
const dbName = `${name}-db`;
let databaseId = JSON.parse(wrangler("d1", "list", "--json")).find((db) => db.name === dbName)?.uuid;
if (databaseId) console.log(`Reusing existing D1 database ${dbName} (${databaseId}).`);
else {
  const created = wrangler("d1", "create", dbName);
  databaseId = created.match(/"database_id":\s*"([0-9a-f-]{36})"/)?.[1] ?? created.match(/([0-9a-f]{8}-[0-9a-f-]{27})/)?.[1];
  if (!databaseId) fail(`could not read the new database id from wrangler output:\n${created}`);
  console.log(`Created D1 database ${dbName} (${databaseId}).`);
}

// R2: create or reuse
const bucketName = `${name}-files`;
try {
  wrangler("r2", "bucket", "create", bucketName);
  console.log(`Created R2 bucket ${bucketName}.`);
} catch (error) {
  const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  if (!/already (exists|owned)/i.test(output)) throw error;
  console.log(`Reusing existing R2 bucket ${bucketName}.`);
}

// Rewrite wrangler.jsonc. String surgery keeps the file's comments/shape.
let config = readFileSync("wrangler.jsonc", "utf8");
const swap = (pattern, replacement, label) => {
  // match, don't compare: the new value may legitimately equal the old one
  if (!pattern.test(config)) fail(`could not rewrite ${label} in wrangler.jsonc - has its shape changed?`);
  config = config.replace(pattern, replacement);
};
swap(/"name":\s*"[^"]*"/, `"name": ${JSON.stringify(name)}`, "name");
swap(/"database_name":\s*"[^"]*"/, `"database_name": ${JSON.stringify(dbName)}`, "database_name");
swap(/"database_id":\s*"[^"]*"/, `"database_id": ${JSON.stringify(databaseId)}`, "database_id");
swap(/"bucket_name":\s*"[^"]*"/, `"bucket_name": ${JSON.stringify(bucketName)}`, "bucket_name");
swap(/"OWNER_EMAIL":\s*"[^"]*"/, `"OWNER_EMAIL": ${JSON.stringify(owner.toLowerCase())}`, "OWNER_EMAIL");
swap(/"ARCHIVE_NAME":\s*"[^"]*"/, `"ARCHIVE_NAME": ${JSON.stringify(archiveName)}`, "ARCHIVE_NAME");
const origin = args.get("origin") ?? `https://${name}.workers.dev`;
swap(/"PUBLIC_ORIGIN":\s*"[^"]*"/, `"PUBLIC_ORIGIN": ${JSON.stringify(origin)}`, "PUBLIC_ORIGIN");
if (args.get("tagline")) swap(/"ARCHIVE_TAGLINE":\s*"[^"]*"/, `"ARCHIVE_TAGLINE": ${JSON.stringify(args.get("tagline"))}`, "ARCHIVE_TAGLINE");
// reference-instance leftovers that must not follow a new deployment
config = config.replace(/\s*"ARCHIVE_NAME_FA":\s*"[^"]*",/, "");
config = config.replace(/\s*"ARCHIVE_PROMPT_CONTEXT":\s*"[^"]*",/, "");
if (!args.get("origin")) config = config.replace(/,?\s*"routes":\s*\[[^\]]*\]/, "");
writeFileSync("wrangler.jsonc", config);
console.log("Rewrote wrangler.jsonc for this deployment.");

// First deploy - the worker must exist before a secret can be attached to
// it, and the deploy output is where the real workers.dev URL appears.
console.log("Building and deploying (a minute or two)…");
execFileSync("npm", ["run", "build"], { stdio: ["ignore", "ignore", "inherit"] });
execFileSync("node", ["scripts/normalize-deploy-config.mjs"], { stdio: "inherit" });
const deployOutput = execFileSync("npx", ["wrangler", "deploy", "--keep-vars"], { encoding: "utf8" });
process.stdout.write(deployOutput.split("\n").slice(-6).join("\n"));

// workers.dev URLs carry the account subdomain, which is only knowable from
// the deploy output; correct PUBLIC_ORIGIN and redeploy the config if the
// guess was wrong (the second deploy reuses the build).
let liveOrigin = origin;
const advertised = deployOutput.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/)?.[0];
if (!args.get("origin") && advertised && advertised !== origin) {
  liveOrigin = advertised;
  writeFileSync("wrangler.jsonc", readFileSync("wrangler.jsonc", "utf8").replace(/"PUBLIC_ORIGIN":\s*"[^"]*"/, `"PUBLIC_ORIGIN": ${JSON.stringify(liveOrigin)}`));
  execFileSync("npx", ["wrangler", "deploy", "--keep-vars"], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`Corrected PUBLIC_ORIGIN to ${liveOrigin} and redeployed.`);
}

// Session secret - kept in this process just long enough to derive the
// bootstrap sign-in link below; never written to disk here.
const sessionSecret = randomBytes(48).toString("base64");
execFileSync("npx", ["wrangler", "secret", "put", "AUTH_SESSION_SECRET", "--name", name], { input: sessionSecret, stdio: ["pipe", "inherit", "inherit"] });
console.log("Set AUTH_SESSION_SECRET.");

// First-run sign-in that needs no OAuth console: an HMAC only the holder of
// the session secret can mint. It retires itself once the owner links a real
// provider (app/api/auth/bootstrap).
const bootstrap = createHmac("sha256", sessionSecret).update(`bootstrap-signin:${owner.toLowerCase()}`)
  .digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

console.log(`
Deployed. Next:

  1. Sign in as the owner - no OAuth setup needed yet - by opening:

       ${liveOrigin}/api/auth/bootstrap?token=${bootstrap}

     (Keep it private; it is the owner's key until real sign-in exists,
      and it stops working the moment the owner links Apple or Google.)
  2. Archivist (any time): npx wrangler secret put OPENAI_API_KEY --name ${name}
  3. Real sign-in, when the family should join (HUMAN, console clicks):
     - Google: OAuth client with redirect ${liveOrigin}/api/auth/google/callback
       -> set GOOGLE_CLIENT_ID var + GOOGLE_CLIENT_SECRET secret
     - Apple: Services ID with callback ${liveOrigin}/api/auth/apple/callback
       -> APPLE_CLIENT_ID/APPLE_TEAM_ID/APPLE_KEY_ID vars + APPLE_PRIVATE_KEY secret
`);
