// `vinext build` writes dist/server/wrangler.json and points wrangler at it
// through .wrangler/deploy/config.json. As of vinext 1.0.0-beta.3 that file
// also carries the host's own placeholder bindings (site-creator-d1,
// site-creator-r2) alongside ours, and wrangler refuses to deploy a Worker
// with two bindings of the same name. Keep the project's real bindings.
import { readFileSync, writeFileSync } from "node:fs";

const path = "dist/server/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));

const keepReal = (list, nameKey) => {
  const byBinding = new Map();
  for (const entry of list ?? []) {
    const placeholder = String(entry[nameKey] ?? "").startsWith("site-creator-");
    const existing = byBinding.get(entry.binding);
    if (!existing || !placeholder) byBinding.set(entry.binding, entry);
  }
  return [...byBinding.values()];
};

const before = JSON.stringify(config);
config.r2_buckets = keepReal(config.r2_buckets, "bucket_name");
config.d1_databases = keepReal(config.d1_databases, "database_name");
config.compatibility_flags = [...new Set(config.compatibility_flags ?? [])];

if (JSON.stringify(config) === before) {
  console.log("deploy config already clean");
} else {
  writeFileSync(path, JSON.stringify(config));
  console.log("deploy config normalized:",
    config.d1_databases.map((entry) => `${entry.binding}=${entry.database_name}`).join(", "),
    "|", config.r2_buckets.map((entry) => `${entry.binding}=${entry.bucket_name}`).join(", "));
}
