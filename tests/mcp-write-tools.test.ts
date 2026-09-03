import { describe, expect, it } from "vitest";
import { MCP_WRITE_TOOLS } from "../lib/mcp-write-tools";
import { isChangeProposal } from "../lib/change-proposal";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName: string): Person => ({
  id, displayName, gender: null, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null,
  birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null,
  biography: null, photoAttachmentId: null,
});

const tree: FamilyTree = {
  people: [person("p1", "Farhad Golestani"), person("p2", "Mina Golestani")],
  relationships: [{ id: "r1", fromPersonId: "p1", toPersonId: "p2", type: "spouse", status: "married" }],
  stories: [],
};

const build = (name: string, args: Record<string, unknown>) => {
  const tool = MCP_WRITE_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.build(args, tree);
};

describe("mcp write tool builders", () => {
  it("builds a valid add_person proposal and demands a source note", () => {
    const { proposals: [proposal], note } = build("propose_person", { display_name: "Kian Golestani", birth_date: "1998", source_note: "his cousin told me" });
    expect(isChangeProposal(proposal)).toBe(true);
    expect(proposal.kind).toBe("add_person");
    expect(note).toBe("his cousin told me");
  });

  it("refuses a person whose exact name is already recorded", () => {
    expect(() => build("propose_person", { display_name: "farhad golestani", source_note: "x" })).toThrow(/already be recorded/);
  });

  it("builds a relationship proposal only between recorded people", () => {
    const child = { ...tree, people: [...tree.people, person("p3", "Roya Golestani")] };
    const tool = MCP_WRITE_TOOLS.find((candidate) => candidate.name === "propose_relationship")!;
    const { proposals: [proposal] } = tool.build({ from_person_id: "p1", to_person_id: "p3", relationship_type: "parent", source_note: "x" }, child);
    expect(isChangeProposal(proposal)).toBe(true);
    expect(() => build("propose_relationship", { from_person_id: "p1", to_person_id: "missing", relationship_type: "parent", source_note: "x" })).toThrow(/find_person/);
  });

  it("refuses an already-recorded marriage in either direction", () => {
    expect(() => build("propose_relationship", { from_person_id: "p2", to_person_id: "p1", relationship_type: "spouse", source_note: "x" })).toThrow(/already recorded/);
  });

  it("builds a story proposal linked to known people", () => {
    const { proposals: [proposal] } = build("propose_story", { title: "The wedding", body: "It rained.", person_ids: ["p1", "p2"], source_note: "family letter" });
    expect(isChangeProposal(proposal)).toBe(true);
    expect(proposal.kind).toBe("add_story");
  });

  it("offers no destructive tools", () => {
    expect(MCP_WRITE_TOOLS.map((tool) => tool.name).sort()).toEqual(["propose_person", "propose_relationship", "propose_story", "record_life_event"]);
  });
});
