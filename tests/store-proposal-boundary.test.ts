import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {}, waitUntil: vi.fn() }));

import { applyProposal } from "../db/store";

describe("store proposal boundary", () => {
  it("rejects malformed internal proposals before touching D1", async () => {
    const oversizedFanout = {
      kind: "add_story",
      summary: "Too many links",
      title: "Story",
      body: "Text",
      date: null,
      place: null,
      personIds: Array.from({ length: 513 }, (_, index) => `person-${index}`),
      attachmentIds: [],
    };
    await expect(applyProposal(oversizedFanout as never, "ingest@example.com"))
      .rejects.toThrow("Invalid change proposal.");
  });
});
