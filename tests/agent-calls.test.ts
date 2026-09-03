import { describe, expect, it } from "vitest";
import { proposalFromCall } from "../lib/agent-calls";

describe("agent merge tool", () => {
  it("turns an explicit duplicate merge call into one atomic proposal", () => {
    expect(proposalFromCall({ name: "propose_merge_people", arguments: JSON.stringify({
      summary: "Merge duplicate Farhad records",
      source_person_id: "duplicate",
      target_person_id: "canonical",
    }) })).toEqual({
      kind: "merge_people", summary: "Merge duplicate Farhad records",
      sourcePersonId: "duplicate", targetPersonId: "canonical",
    });
  });
});
