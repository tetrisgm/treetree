import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  clearAccessPassword: vi.fn(),
  getSiteVisibility: vi.fn(),
  hasAccessPassword: vi.fn(),
  setAccessPasswordDigest: vi.fn(),
  setShareToken: vi.fn(),
  setSiteVisibility: vi.fn(),
  shareToken: vi.fn(),
}));
const authz = vi.hoisted(() => ({ requireAdmin: vi.fn() }));

vi.mock("../db/store", () => store);
vi.mock("../app/authz", () => authz);

import { GET, POST } from "../app/api/site/route";

beforeEach(() => {
  vi.clearAllMocks();
  authz.requireAdmin.mockResolvedValue({
    ok: true,
    user: { subject: "admin", email: "admin@example.com", displayName: "Admin" },
  });
  store.getSiteVisibility.mockResolvedValue("password");
  store.hasAccessPassword.mockResolvedValue(true);
  store.shareToken.mockResolvedValue("private-link-token");
});

describe("site access settings responses", () => {
  it("reads each setting once and never exposes state to shared caches", async () => {
    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      visibility: "password",
      hasPassword: true,
      shareUrl: "/api/access?key=private-link-token",
    });
    expect(store.getSiteVisibility).toHaveBeenCalledOnce();
    expect(store.hasAccessPassword).toHaveBeenCalledOnce();
    expect(store.shareToken).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("keeps secret-bearing mutation responses private too", async () => {
    const response = await POST(new Request("https://archive.example/api/site", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "new_link" }),
    }));

    expect(store.setShareToken).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});
