import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ listEvidenceClaims: vi.fn(), setEvidenceClaimStatus: vi.fn() }));
const authz = vi.hoisted(() => ({ requireEditor: vi.fn() }));
vi.mock("../db/store", () => store);
vi.mock("../app/authz", () => authz);

import { GET, POST } from "../app/api/claims/route";

beforeEach(() => {
  vi.clearAllMocks();
  authz.requireEditor.mockResolvedValue({ ok: true, user: { email: "editor@example.com" } });
  store.listEvidenceClaims.mockResolvedValue([{ id: "claim-1" }]);
  store.setEvidenceClaimStatus.mockResolvedValue([{ id: "claim-1", status: "preferred" }]);
});

describe("evidence claims route", () => {
  it("returns a private, uncached subject claim list", async () => {
    const response = await GET(new Request("https://archive.example/api/claims?subjectType=person&subjectId=person-1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(store.listEvidenceClaims).toHaveBeenCalledWith("person", "person-1");
    await expect(response.json()).resolves.toEqual({ claims: [{ id: "claim-1" }] });
  });

  it("rejects invalid subjects without querying storage", async () => {
    const response = await GET(new Request("https://archive.example/api/claims?subjectType=story&subjectId=story-1"));
    expect(response.status).toBe(400);
    expect(store.listEvidenceClaims).not.toHaveBeenCalled();
  });

  it("lets an editor adjudicate a disputed claim", async () => {
    const response = await POST(new Request("https://archive.example/api/claims", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ claimId: "claim-1", status: "preferred" }),
    }));
    expect(response.status).toBe(200);
    expect(store.setEvidenceClaimStatus).toHaveBeenCalledWith("claim-1", "preferred", "editor@example.com");
  });
});
