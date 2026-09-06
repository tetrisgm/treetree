#!/usr/bin/env node
/** Copy this instance's shared code into the public product cut.
 *
 * The public repository is the same product with the family taken out of it:
 * same files, a handful of names neutralised. That sync was done by hand
 * until now - copy the changed files, remember three sed edits, run a grep,
 * hope. One forgotten edit publishes a family name, so it is a script with a
 * gate rather than a ritual.
 *
 *   node scripts/sync-public.mjs --to ../treetree [--dry-run]
 *
 * Refuses to leave anything behind that names the family: the sweep runs
 * over the destination after copying, and a hit outside LICENSE fails the
 * run with the offending files listed.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const dryRun = args.includes("--dry-run");
const source = resolve(flag("--from", process.cwd()));
const destination = resolve(flag("--to") ?? "");
if (!flag("--to")) { console.error("Usage: node scripts/sync-public.mjs --to <public checkout> [--dry-run]"); process.exit(2); }
if (!existsSync(join(destination, ".git"))) { console.error(`Not a checkout: ${destination}`); process.exit(2); }

/** Files that belong only to this instance: its identity, its deployment,
 * its private notes. Everything else in the tracked tree is product. */
const PRIVATE = [
  /^wrangler\.jsonc$/, /^docs\//, /^scripts\/legacy/, /^data\//, /^video\//,
  /^lib\/build\.ts$/, /^README\.md$/, /^AGENTS\.md$/, /^LICENSE$/,
  /^\.wrangler\//, /^test-results\//, /^playwright\.local\.config\.ts$/,
  /^\.openai\//, /^public\/og\.png$/, /^scripts\/check_data_model\.mjs$/,
];

/** Files the public cut owns outright, because its version is a different
 * thing rather than the same thing with a name changed: harnesses that read
 * this Mac's Keychain, config naming this deployment, the product's own
 * package scripts. A change here needs a person, so the sync reports it and
 * leaves the file alone. */
const PUBLIC_OWNED = [
  /^scripts\/test-oauth-mcp-loop\.py$/, /^playwright\.config\.ts$/,
  /^package\.json$/, /^\.gitignore$/,
];

/** The neutralisations: what the product says where this instance says the
 * family's name. Applied to the copy, never to the source. */
const NEUTRALISE = [
  /* The browser suites read this Mac's Keychain for a session secret when
     the env var is absent. A stranger's checkout has no such item, so the
     product asks for the variable instead - and the suites themselves keep
     flowing to the public repo as they are written. */
  { from: /^import \{ execFileSync \} from "node:child_process";\n/m, to: "", files: /^tests\/browser\// },
  { from: /const secret = process\.env\.PLAYWRIGHT_SESSION_SECRET\n\s*\|\| execFileSync\("security", \["find-generic-password", "-s", "darabiha-session-secret", "-w"\]\)\.toString\(\)\.trim\(\);/g,
    to: 'const secret = process.env.PLAYWRIGHT_SESSION_SECRET || "";\n  if (!secret) throw new Error("Set PLAYWRIGHT_SESSION_SECRET to your deployment\'s AUTH_SESSION_SECRET (and PLAYWRIGHT_BASE_URL / PLAYWRIGHT_MEMBER_EMAIL).");',
    files: /^tests\/browser\// },
  { from: /"browser-suite@archive\.example"/g, to: '"browser-suite@example.com"', files: /^tests\/browser\// },
  { from: /baseURL \?\? "https:\/\/archive\.example"/g, to: 'baseURL ?? "http://localhost:8787"', files: /^tests\/browser\// },
  // cookies and storage carry the archive's name in this instance
  { from: /archive_session/g, to: "archive_session" },
  { from: /archive_access/g, to: "archive_access" },
  { from: /archive_lang/g, to: "archive_lang" },
  { from: /"archive-chat-width"/g, to: '"archive-chat-width"' },
  { from: /"archive-view"/g, to: '"archive-view"' },
  // the family's own domain and addresses, in test fixtures and defaults
  { from: /https:\/\/darabiha\.com/g, to: "https://archive.example" },
  { from: /@darabiha\.com/g, to: "@archive.example" },
  // and the family's own name, where a fixture happens to use it
  { from: /Zehtab Golestani\b/g, to: "Zehtab Golestani" },
  { from: /\bDarabiha\b/g, to: "Golestani" },
  { from: /\bDarabi\b/g, to: "Golestani" },
];

const SWEEP = /\bdarabi(ha)?\b|ramine@|leshokunin|darabiha\.com/i;
/** LICENSE carries the copyright holder's real name, as a licence must. */
const SWEEP_EXEMPT = [/^LICENSE$/];

const tracked = execFileSync("git", ["-C", source, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const shared = tracked.filter((file) => !PRIVATE.some((pattern) => pattern.test(file)));

const isText = (file) => !/\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?|mp4|webm)$/i.test(file);
const written = new Map();
let copied = 0, patched = 0, skipped = [];
for (const file of shared) {
  const from = join(source, file), to = join(destination, file);
  if (PUBLIC_OWNED.some((pattern) => pattern.test(file))) {
    // report only when the product's own copy has drifted from ours
    if (existsSync(to) && isText(file) && readFileSync(from, "utf8") !== readFileSync(to, "utf8")) skipped.push(file);
    continue;
  }
  const before = existsSync(to) ? readFileSync(to) : null;
  let content = readFileSync(from);
  if (isText(file)) {
    let text = content.toString("utf8");
    const original = text;
    for (const edit of NEUTRALISE) if (!edit.files || edit.files.test(file)) text = text.replace(edit.from, edit.to);
    if (text !== original) patched += 1;
    content = Buffer.from(text, "utf8");
  }
  written.set(file, content);
  if (before && before.equals(content)) continue;
  copied += 1;
  if (dryRun) { console.log(`would write ${file}`); continue; }
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, content);
}

/* The gate, over what this run would leave behind: the files it writes as
   it would write them, plus everything already in the destination it did
   not touch. A dry run is therefore as trustworthy as a real one. */
const destinationFiles = execFileSync("git", ["-C", destination, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const candidates = new Set([...destinationFiles, ...written.keys()]);
const leaked = [...candidates].filter((file) => {
  if (SWEEP_EXEMPT.some((pattern) => pattern.test(file)) || !isText(file)) return false;
  const content = written.get(file);
  try { return SWEEP.test(content ? content.toString("utf8") : readFileSync(join(destination, file), "utf8")); } catch { return false; }
});

console.log(`${dryRun ? "Would sync" : "Synced"} ${copied} file${copied === 1 ? "" : "s"} (${patched} neutralised) of ${shared.length} shared, into ${destination}`);
if (skipped.length) console.log(`\nThe public cut owns these and they have drifted - review by hand if the change matters there:\n${skipped.map((file) => `  ${file}`).join("\n")}`);
if (leaked.length) {
  console.error(`\nSWEEP FAILED - these name the family:\n${leaked.map((file) => `  ${file}`).join("\n")}\n\nAdd a rule to NEUTRALISE or PRIVATE in scripts/sync-public.mjs, then run again.`);
  process.exit(1);
}
console.log("Sweep clean: nothing in the public cut names the family.");
if (!dryRun) console.log(`\nNext: cd ${destination} && git add -A && git commit && git push`);
