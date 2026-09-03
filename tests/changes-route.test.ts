import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ applyProposal: vi.fn() }));
const authz = vi.hoisted(() => ({ requireEditor: vi.fn() }));

vi.mock("../db/store", () => store);
vi.mock("../app/authz", () => authz);

import { POST } from "../app/api/changes/route";

beforeEach(() => {
  vi.clearAllMocks();
  authz.requireEditor.mockResolvedValue({ ok: true, user: { email: "editor@example.com" } });
  store.applyProposal.mockResolvedValue({ people: [], relationships: [], stories: [] });
});

describe("change proposal route", () => {
  it("rejects malformed updates before calling the store", async () => {
    const response = await POST(new Request("https://archive.example/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "update_person", summary: "Update", personId: "person-1", patch: { displayName: "Farhad" } }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_proposal" });
    expect(store.applyProposal).not.toHaveBeenCalled();
  });

  it("passes a valid destructive proposal to the store", async () => {
    const proposal = { kind: "delete_person", summary: "Delete a duplicate", personId: "person-1" };
    const response = await POST(new Request("https://archive.example/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proposal),
    }));

    expect(response.status).toBe(200);
    expect(store.applyProposal).toHaveBeenCalledWith(proposal, "editor@example.com", {
      sourceType: "family_assertion",
      sourceLabel: "Family member editor@example.com",
      sourceExcerpt: null,
      confidence: 100,
    });
  });

  it("carries uploaded evidence into the claim source", async () => {
    const proposal = { kind: "delete_person", summary: "Delete a duplicate", personId: "person-1" };
    const response = await POST(new Request("https://archive.example/api/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proposal,
        assertion: "This is the duplicate record from the uploaded tree.",
        evidenceAttachments: [{ id: "attachment-1", filename: "family.ged" }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(store.applyProposal).toHaveBeenCalledWith(proposal, "editor@example.com", {
      sourceType: "attachment",
      sourceLabel: "family.ged",
      attachmentId: "attachment-1",
      sourceExcerpt: "This is the duplicate record from the uploaded tree.",
      confidence: 85,
    });
  });
});
