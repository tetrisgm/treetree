import { describe, expect, it } from "vitest";
import { bootstrapToken, digestsEqual } from "../lib/bootstrap-signin";
import { uiActionFromCall } from "../lib/agent-calls";

describe("bootstrap sign-in token", () => {
  it("derives deterministically from owner email and secret, case-insensitively", async () => {
    const first = await bootstrapToken("Owner@Example.com", "secret-a");
    expect(first).toBe(await bootstrapToken("owner@example.com", "secret-a"));
    expect(first).not.toBe(await bootstrapToken("owner@example.com", "secret-b"));
    expect(first).not.toBe(await bootstrapToken("other@example.com", "secret-a"));
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("compares digests without length leaks", async () => {
    const token = await bootstrapToken("owner@example.com", "secret-a");
    expect(digestsEqual(token, token)).toBe(true);
    expect(digestsEqual(token, `${token.slice(0, -1)}x`)).toBe(false);
    expect(digestsEqual(token, "short")).toBe(false);
  });
});

describe("archivist UI actions", () => {
  it("extracts show_person and switch_view, dropping everything else", () => {
    expect(uiActionFromCall({ name: "show_person", arguments: '{"display_name":" Roya Golestani "}' }))
      .toEqual({ type: "show_person", displayName: "Roya Golestani" });
    expect(uiActionFromCall({ name: "switch_view", arguments: '{"view":"map"}' }))
      .toEqual({ type: "switch_view", view: "map" });
    expect(uiActionFromCall({ name: "switch_view", arguments: '{"view":"hack"}' })).toBeNull();
    expect(uiActionFromCall({ name: "propose_add_person", arguments: "{}" })).toBeNull();
    expect(uiActionFromCall({ name: "show_person", arguments: "not json" })).toBeNull();
  });
});
