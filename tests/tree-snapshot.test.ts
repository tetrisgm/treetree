import { describe, expect, it } from "vitest";
import { isD1DailyReadLimitError, nextUtcMidnight, parseMemberAccessSnapshot, parseTreeSnapshot, parseVisibilitySnapshot } from "../lib/tree-snapshot";

describe("tree snapshot fallback", () => {
  it("recognizes only the Cloudflare daily row-read quota failure", () => {
    expect(isD1DailyReadLimitError(new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit."))).toBe(true);
    expect(isD1DailyReadLimitError(new Error("request failed", { cause: new Error("D1_ERROR: DAILY ROW READ LIMIT reached") }))).toBe(true);
    expect(isD1DailyReadLimitError(new Error("D1_ERROR: database unavailable"))).toBe(false);
  });

  it("accepts a complete family tree and rejects malformed snapshots", () => {
    const tree = { people: [], relationships: [], stories: [] };
    expect(parseTreeSnapshot(JSON.stringify(tree))).toEqual(tree);
    expect(parseTreeSnapshot("{}")) .toBeNull();
    expect(parseTreeSnapshot("not json")).toBeNull();
  });

  it("validates the private member-access snapshot shape", () => {
    const snapshot = { members: [{ email: "viewer@example.com", role: "canView", personId: null }], links: [] };
    expect(parseMemberAccessSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(parseMemberAccessSnapshot('{"members":[]}')).toBeNull();
  });

  it("accepts a hand-seeded visibility snapshot with surrounding whitespace", () => {
    // A trailing shell newline in the seeded object made every quota-fallback
    // read throw site_visibility_snapshot_unavailable in production (V197).
    expect(parseVisibilitySnapshot("password\n")).toBe("password");
    expect(parseVisibilitySnapshot("public")).toBe("public");
    expect(parseVisibilitySnapshot(" members ")).toBe("members");
    expect(parseVisibilitySnapshot("")).toBeNull();
    expect(parseVisibilitySnapshot("open")).toBeNull();
  });

  it("closes the quota circuit at the next UTC midnight", () => {
    expect(new Date(nextUtcMidnight(Date.parse("2026-09-01T23:59:00Z"))).toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });
});
