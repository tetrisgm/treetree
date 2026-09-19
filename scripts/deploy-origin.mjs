import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Wrangler deploys vinext's generated config, not the source template.
 * Update both before redeploying the discovered workers.dev origin. */
export function setDeploymentOrigin(origin, projectDirectory = process.cwd()) {
  const sourcePath = join(projectDirectory, "wrangler.jsonc");
  const pointerPath = join(projectDirectory, ".wrangler/deploy/config.json");
  const source = readFileSync(sourcePath, "utf8");
  const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
  const deployedPath = resolve(dirname(pointerPath), pointer.configPath);
  const deployed = JSON.parse(readFileSync(deployedPath, "utf8"));
  const pattern = /"PUBLIC_ORIGIN":\s*"[^"]*"/;
  if (!pattern.test(source) || !deployed.vars || !("PUBLIC_ORIGIN" in deployed.vars)) {
    throw new Error("PUBLIC_ORIGIN is missing from the source or built deployment configuration.");
  }
  const nextSource = source.replace(pattern, () => `"PUBLIC_ORIGIN": ${JSON.stringify(origin)}`);
  deployed.vars.PUBLIC_ORIGIN = origin;
  writeFileSync(sourcePath, nextSource);
  writeFileSync(deployedPath, JSON.stringify(deployed, null, 2) + "\n");
}
