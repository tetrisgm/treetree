import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  getMemberRole: vi.fn(),
  getSiteVisibility: vi.fn(),
}));
const appleAuth = vi.hoisted(() => ({
  getAppleUser: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("../db/store", () => store);
vi.mock("../app/apple-auth", () => appleAuth);
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}));

import { requireVisitor, visitorGate } from "../app/authz";

beforeEach(() => {
  vi.clearAllMocks();
  store.getSiteVisibility.mockResolvedValue("public");
  appleAuth.getAppleUser.mockResolvedValue(null);
});

describe("visitor visibility authorization", () => {
  it("bypasses the isolate cache for an authorization decision", async () => {
    await expect(visitorGate()).resolves.toBe("ok");

    expect(store.getSiteVisibility).toHaveBeenCalledWith(true);
  });

  it("returns the exact fresh visibility used to authorize the response", async () => {
    store.getSiteVisibility.mockResolvedValue("members");
    appleAuth.getAppleUser.mockResolvedValue({
      subject: "member-1",
      email: "member@example.com",
      displayName: "Member",
    });
    store.getMemberRole.mockResolvedValue("canView");

    await expect(requireVisitor()).resolves.toEqual({ ok: true, visibility: "members" });
    expect(store.getSiteVisibility).toHaveBeenCalledTimes(1);
    expect(store.getSiteVisibility).toHaveBeenCalledWith(true);
  });

  it("does not authorize a cached-public view after a fresh private read", async () => {
    store.getSiteVisibility.mockResolvedValue("members");

    const result = await requireVisitor();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});
