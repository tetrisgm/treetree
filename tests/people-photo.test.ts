import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  addRelationship: vi.fn(),
  applyProposal: vi.fn(),
  attachPersonPhoto: vi.fn(),
  linkPersonPhoto: vi.fn(),
  readTree: vi.fn(),
  removePerson: vi.fn(),
  removePersonPhoto: vi.fn(),
  removeRelationship: vi.fn(),
  setPersonPortrait: vi.fn(),
  setRelationshipStatus: vi.fn(),
  unlinkPersonPhoto: vi.fn(),
  updatePerson: vi.fn(),
}));
const authz = vi.hoisted(() => ({ requireEditor: vi.fn() }));

vi.mock("../db/store", () => store);
vi.mock("../app/authz", () => authz);

import { POST } from "../app/api/people/route";

function photoRequest(file: File) {
  const body = new FormData();
  body.set("personId", "person-1");
  body.set("photo", file);
  return new Request("https://archive.example/api/people", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  authz.requireEditor.mockResolvedValue({ ok: true, user: { email: "editor@example.com" } });
  store.attachPersonPhoto.mockResolvedValue({ people: [], relationships: [], stories: [] });
});

describe("person photograph upload", () => {
  it("accepts a raster photograph whose bytes match its format", async () => {
    const response = await POST(photoRequest(new File([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    ], "portrait.jpg", { type: "image/jpeg" })));

    expect(response.status).toBe(200);
    expect(store.attachPersonPhoto).toHaveBeenCalledOnce();
  });

  it("rejects active content disguised as a raster photograph", async () => {
    const response = await POST(photoRequest(new File([
      "<svg><script>alert(1)</script></svg>",
    ], "portrait.png", { type: "image/png" })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_photo" });
    expect(store.attachPersonPhoto).not.toHaveBeenCalled();
  });
});
