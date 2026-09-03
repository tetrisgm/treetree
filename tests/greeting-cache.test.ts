import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ readTree: vi.fn() }));
const authz = vi.hoisted(() => ({ requireVisitor: vi.fn() }));

vi.mock("../db/store", () => store);
vi.mock("../app/authz", () => authz);
vi.mock("../lib/family-facts", () => ({
  familyFactoids: vi.fn(() => []),
  greetingFact: vi.fn(() => null),
}));

import { GET } from "../app/api/greeting/route";

beforeEach(() => {
  vi.clearAllMocks();
  store.readTree.mockResolvedValue({ people: [], relationships: [], stories: [], attachments: [] });
});

describe("greeting cache policy", () => {
  it("allows the public greeting to use the shared five-minute cache", async () => {
    authz.requireVisitor.mockResolvedValue({ ok: true, visibility: "public" });

    const response = await GET();

    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.has("vary")).toBe(false);
  });

  it.each(["members", "password"])("keeps a %s greeting cookie-bound", async (visibility) => {
    authz.requireVisitor.mockResolvedValue({ ok: true, visibility });

    const response = await GET();

    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("prevents a visitor denial from entering a shared cache", async () => {
    authz.requireVisitor.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "sign_in_required" }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});
