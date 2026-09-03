import { describe, expect, it } from "vitest";
import { createRelationshipDescriber, describeRelationship, relationshipSentence } from "../lib/relationship-path";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName: string, gender: Person["gender"] = null): Person => ({
  id, displayName, gender, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null,
  birthCity: null, birthCountry: null, deathCity: null, deathCountry: null,
  burialPlace: null, residence: null, biography: null, photoAttachmentId: null,
});
const parent = (from: string, to: string) => ({ id: `p-${from}-${to}`, fromPersonId: from, toPersonId: to, type: "parent" as const, status: null });
const spouse = (a: string, b: string) => ({ id: `s-${a}-${b}`, fromPersonId: a, toPersonId: b, type: "spouse" as const, status: null });

// grandfather -> two sons -> a grandchild each (the cousins)
const tree: FamilyTree = {
  people: [
    person("gf", "Grandfather", "male"), person("gm", "Grandmother", "female"),
    person("f", "Father", "male"), person("u", "Uncle", "male"), person("aunt", "Aunt", "female"),
    person("me", "Me", "male"), person("sis", "Sister", "female"), person("cous", "Cousin", "female"),
    person("cousKid", "Cousin's daughter", "female"), person("wife", "Wife", "female"),
    person("stranger", "Stranger"),
  ],
  relationships: [
    parent("gf", "f"), parent("gm", "f"), parent("gf", "u"), parent("gm", "u"),
    parent("f", "me"), parent("f", "sis"), parent("u", "cous"), parent("cous", "cousKid"),
    spouse("gf", "gm"), spouse("u", "aunt"), spouse("me", "wife"),
  ],
  stories: [],
};
const rel = (from: string, to: string) => describeRelationship(tree, from, to)?.relationship;

describe("relationship paths", () => {
  it("names the direct line in both directions", () => {
    expect(rel("me", "f")).toBe("father");
    expect(rel("me", "gf")).toBe("grandfather");
    expect(rel("gf", "me")).toBe("grandson");
    expect(rel("cousKid", "gf")).toBe("great-grandfather");
  });

  it("names siblings, aunts, uncles and nephews", () => {
    expect(rel("me", "sis")).toBe("sister");
    expect(rel("me", "u")).toBe("uncle");
    expect(rel("u", "me")).toBe("nephew");
    expect(rel("gf", "cousKid")).toBe("great-granddaughter");
  });

  it("counts cousins and how far removed they are", () => {
    expect(rel("me", "cous")).toBe("first cousin");
    expect(rel("me", "cousKid")).toBe("first cousin once removed");
  });

  it("handles marriage and unconnected people", () => {
    expect(rel("me", "wife")).toBe("wife");
    expect(rel("me", "aunt")).toContain("by marriage");
    expect(rel("me", "stranger")).toBe("not connected in the records");
  });

  it("writes a sentence naming the shared ancestors", () => {
    const result = describeRelationship(tree, "me", "cous")!;
    expect(relationshipSentence(result)).toBe("Cousin is Me's first cousin. They share Grandfather and Grandmother.");
  });

  it("does not claim a direct ancestor is shared with himself", () => {
    expect(relationshipSentence(describeRelationship(tree, "me", "gf")!)).toBe("Grandfather is Me's grandfather.");
  });

  it("reuses one graph index when describing several pairs", () => {
    const describe = createRelationshipDescriber(tree);
    expect(describe("me", "cous")?.relationship).toBe("first cousin");
    expect(describe("me", "wife")?.relationship).toBe("wife");
    expect(describe("me", "stranger")?.relationship).toBe("not connected in the records");
  });
});
