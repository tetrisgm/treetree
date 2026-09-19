import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setDeploymentOrigin } from "../scripts/deploy-origin.mjs";

describe("first-deploy origin correction", () => {
  it("updates the config Wrangler actually deploys as well as the source template", () => {
    const root = mkdtempSync(join(tmpdir(), "treetree-origin-"));
    try {
      mkdirSync(join(root, ".wrangler/deploy"), { recursive: true });
      mkdirSync(join(root, "dist/server"), { recursive: true });
      const config = { name: "test-archive", vars: { PUBLIC_ORIGIN: "https://guess.workers.dev", ARCHIVE_NAME: "Fictional" }, d1_databases: [{ binding: "DB", database_id: "fixture" }] };
      writeFileSync(join(root, "wrangler.jsonc"), "// preserve this comment\n" + JSON.stringify(config));
      writeFileSync(join(root, "dist/server/wrangler.json"), JSON.stringify(config));
      writeFileSync(join(root, ".wrangler/deploy/config.json"), JSON.stringify({ configPath: "../../dist/server/wrangler.json" }));
      const origin = "https://test-archive.example.workers.dev";
      setDeploymentOrigin(origin, root);
      expect(readFileSync(join(root, "wrangler.jsonc"), "utf8")).toContain(origin);
      expect(readFileSync(join(root, "wrangler.jsonc"), "utf8")).toContain("preserve this comment");
      expect(JSON.parse(readFileSync(join(root, "dist/server/wrangler.json"), "utf8"))).toEqual({ ...config, vars: { ...config.vars, PUBLIC_ORIGIN: origin } });
    } finally { rmSync(root, { recursive: true }); }
  });

  it("does not change the template when the generated deployment is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "treetree-origin-"));
    try {
      const source = '{"vars":{"PUBLIC_ORIGIN":"https://example.com"}}';
      writeFileSync(join(root, "wrangler.jsonc"), source);
      expect(() => setDeploymentOrigin("https://new.example", root)).toThrow();
      expect(readFileSync(join(root, "wrangler.jsonc"), "utf8")).toBe(source);
    } finally { rmSync(root, { recursive: true }); }
  });
});
