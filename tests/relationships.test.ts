import { describe, expect, it } from "vitest";
import { relatedPeople } from "../lib/relationships";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName = id): Person => ({ id, displayName, givenName: null, familyName: null, maidenName: null, birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null });
const tree: FamilyTree = {
  people: ["grandparent", "parent", "me", "sibling", "child", "cousin", "spouse"].map((id) => person(id)),
  relationships: [
    { id: "r1", fromPersonId: "grandparent", toPersonId: "parent", type: "parent" },
    { id: "r2", fromPersonId: "grandparent", toPersonId: "sibling", type: "parent" },
    { id: "r3", fromPersonId: "parent", toPersonId: "me", type: "parent" },
    { id: "r4", fromPersonId: "me", toPersonId: "child", type: "parent" },
    { id: "r5", fromPersonId: "sibling", toPersonId: "cousin", type: "parent" },
    { id: "r6", fromPersonId: "me", toPersonId: "spouse", type: "spouse" },
  ], stories: [],
};

describe("family relationship resolution", () => {
  it("resolves direct and extended relatives for a person", () => {
    const result = relatedPeople(tree, "me");
    expect(result.parents.map((p) => p.id)).toEqual(["parent"]);
    expect(result.children.map((p) => p.id)).toEqual(["child"]);
    expect(result.spouses.map((p) => p.id)).toEqual(["spouse"]);
    expect(result.siblings).toEqual([]);
    expect(result.cousins).toEqual([]);
  });

  it("resolves siblings and cousins from the shared parent branch", () => {
    const result = relatedPeople(tree, "parent");
    expect(result.siblings.map((p) => p.id)).toEqual(["sibling"]);
    expect(result.cousins.map((p) => p.id)).toEqual(["cousin"]);
  });
});
