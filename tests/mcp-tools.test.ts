import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../lib/mcp-tools";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName: string, extra: Partial<Person> = {}): Person => ({
  id, displayName, gender: null, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null,
  birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null,
  biography: null, photoAttachmentId: null, ...extra,
});

const tree: FamilyTree = {
  people: [
    person("p1", "Farhad Golestani", { birthDate: "1940-02-01", birthCity: "Tehran" }),
    person("p2", "Mina Golestani"),
    person("p3", "Roya Golestani", { birthDate: "1972" }),
  ],
  relationships: [
    { id: "r1", fromPersonId: "p1", toPersonId: "p2", type: "spouse", status: "married" },
    { id: "r2", fromPersonId: "p1", toPersonId: "p3", type: "parent", status: null },
    { id: "r3", fromPersonId: "p2", toPersonId: "p3", type: "parent", status: null },
  ],
  stories: [{ id: "s1", title: "The move to Tehran", body: "A story.", originalBody: "داستان", date: "1965", place: "Tehran", personIds: ["p1"], attachmentIds: [] }],
  rootPersonId: "p1",
};

const run = (name: string, args: Record<string, unknown> = {}) => {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.handler(args, tree, { egoId: "p3" });
};

describe("mcp tool registry", () => {
  it("summarizes the archive and names the root person", () => {
    const summary = run("tree_summary");
    expect(summary).toContain("3 people");
    expect(summary).toContain("Farhad Golestani");
  });

  it("finds people case-insensitively and returns ids", () => {
    expect(run("find_person", { query: "roya" })).toContain("[id: p3]");
    expect(run("find_person", { query: "nobody" })).toContain("No person matching");
    expect(() => run("find_person", { query: "  " })).toThrow();
  });

  it("renders a complete person record with relatives and stories", () => {
    const record = run("person_record", { person_id: "p1" });
    expect(record).toContain("Born: 1940-02-01, Tehran");
    expect(record).toContain("Spouses: Mina Golestani");
    expect(record).toContain("Children: Roya Golestani");
    expect(record).toContain("The move to Tehran");
    expect(() => run("person_record", { person_id: "missing" })).toThrow(/find_person/);
  });

  it("describes how two people are related", () => {
    expect(run("relationship_path", { from_person_id: "p3", to_person_id: "p1" })).toMatch(/father|parent/i);
  });

  it("returns a story with its original text", () => {
    const story = run("story", { story_id: "s1" });
    expect(story).toContain("داستان");
    expect(run("list_stories")).toContain("[id: s1]");
  });

  it("declares every tool read-only through the registry shape", () => {
    expect(MCP_TOOLS.map((tool) => tool.name).sort()).toEqual(
      ["family_in_year", "family_origins", "find_person", "how_am_i_related", "life_of", "list_stories",
        "namesakes", "person_record", "relationship_path", "story", "tree_summary", "upcoming_family_dates"],
    );
  });
});
