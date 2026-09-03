import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ listChangeLog: vi.fn(), undoChange: vi.fn() }));
const authz = vi.hoisted(() => ({ requireEditor: vi.fn() }));
vi.mock("../db/store", () => store);
vi.mock("../app/authz", () => authz);

import { POST } from "../app/api/history/route";

beforeEach(() => {
  vi.clearAllMocks();
  authz.requireEditor.mockResolvedValue({ ok: true, user: { email: "editor@example.com" } });
  store.undoChange.mockResolvedValue({ people: [], relationships: [], stories: [] });
});

describe("history undo route", () => {
  it("undoes an eligible audited change", async () => {
    const response = await POST(new Request("https://archive.example/api/history", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeId: "change-1" }),
    }));
    expect(response.status).toBe(200);
    expect(store.undoChange).toHaveBeenCalledWith("change-1", "editor@example.com");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("rejects a missing change id", async () => {
    const response = await POST(new Request("https://archive.example/api/history", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(response.status).toBe(400);
    expect(store.undoChange).not.toHaveBeenCalled();
  });
});
