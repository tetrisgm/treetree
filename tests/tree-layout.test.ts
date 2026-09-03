import { describe, expect, it } from "vitest";
import { buildFamilyLayout, buildGenerations } from "../lib/tree-layout";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string): Person => ({ id, displayName: id, givenName: null, familyName: null, maidenName: null, birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null });
const tree: FamilyTree = { people: ["mother", "father", "daughter", "son", "grandchild"].map(person), relationships: [
  { id: "p1", fromPersonId: "mother", toPersonId: "daughter", type: "parent" },
  { id: "p2", fromPersonId: "father", toPersonId: "daughter", type: "parent" },
  { id: "p3", fromPersonId: "mother", toPersonId: "son", type: "parent" },
  { id: "p4", fromPersonId: "father", toPersonId: "son", type: "parent" },
  { id: "p5", fromPersonId: "daughter", toPersonId: "grandchild", type: "parent" },
], stories: [] };

describe("tree generation layout", () => {
  it("places parents above children and grandchildren below", () => {
    const result = buildGenerations(tree);
    expect(result.depth.get("mother")).toBe(0);
    expect(result.depth.get("father")).toBe(0);
    expect(result.depth.get("daughter")).toBe(1);
    expect(result.depth.get("son")).toBe(1);
    expect(result.depth.get("grandchild")).toBe(2);
  });

  it("keeps siblings in the same generation group", () => {
    const result = buildGenerations(tree);
    expect(result.groups.get(1)?.map((person) => person.id)).toEqual(["daughter", "son"]);
  });

  it("is independent of parent-edge storage order", () => {
    const reversed = buildGenerations({ ...tree, relationships: [...tree.relationships].reverse() });
    expect(reversed.depth.get("mother")).toBe(0);
    expect(reversed.depth.get("daughter")).toBe(1);
    expect(reversed.depth.get("grandchild")).toBe(2);
  });

  it("draws a couple side by side with their children beneath them", () => {
    const layout = buildFamilyLayout(tree);
    const mother = layout.positions.get("mother")!;
    const father = layout.positions.get("father")!;
    const daughter = layout.positions.get("daughter")!;
    const son = layout.positions.get("son")!;
    expect(Math.abs(mother.x - father.x)).toBe(1); // adjacent slots
    expect(mother.y).toBe(father.y);
    expect(daughter.y).toBe(mother.y + 1);
    const coupleCenter = (mother.x + father.x) / 2;
    const childrenCenter = (Math.min(daughter.x, son.x) + Math.max(daughter.x, son.x)) / 2;
    expect(Math.abs(coupleCenter - childrenCenter)).toBeLessThan(1.01);
  });

  it("draws every person exactly once, even children of a cousin marriage", () => {
    const cousinTree: FamilyTree = {
      people: ["root", "a", "b", "child"].map(person),
      relationships: [
        { id: "p1", fromPersonId: "root", toPersonId: "a", type: "parent" },
        { id: "p2", fromPersonId: "root", toPersonId: "b", type: "parent" },
        { id: "s1", fromPersonId: "a", toPersonId: "b", type: "spouse" },
        { id: "p3", fromPersonId: "a", toPersonId: "child", type: "parent" },
        { id: "p4", fromPersonId: "b", toPersonId: "child", type: "parent" },
      ],
      stories: [],
    };
    const layout = buildFamilyLayout(cousinTree);
    expect(layout.positions.size).toBe(4);
    expect([...layout.positions.values()].every((slot) => Number.isFinite(slot.x) && Number.isFinite(slot.y))).toBe(true);
    expect(layout.positions.get("child")!.y).toBe(2);
  });

  it("keeps children in the deep family line when a bride's father is recorded", () => {
    const withInLaw: FamilyTree = {
      people: [...tree.people, person("bride"), person("bride-father"), person("grandchild3")].map((p) => p),
      relationships: [
        ...tree.relationships,
        { id: "s2", fromPersonId: "bride", toPersonId: "son", type: "spouse" },
        { id: "p8", fromPersonId: "bride-father", toPersonId: "bride", type: "parent" },
        { id: "p9", fromPersonId: "son", toPersonId: "grandchild3", type: "parent" },
        { id: "p10", fromPersonId: "bride", toPersonId: "grandchild3", type: "parent" },
      ],
      stories: [],
    };
    const layout = buildFamilyLayout(withInLaw);
    // the grandchild stays under the son (two generations of ancestry), not
    // under the bride (one recorded generation)
    expect(layout.primaryParent.get("grandchild3")).toBe("son");
    const generations = buildGenerations(withInLaw);
    // the bride's father sits one row above his daughter, not in the top row
    expect(generations.depth.get("bride")).toBe(1);
    expect(generations.depth.get("bride-father")).toBe(0);
    const deep: FamilyTree = {
      ...withInLaw,
      relationships: [...withInLaw.relationships, { id: "p11", fromPersonId: "grandchild", toPersonId: "greatgrand", type: "parent" }],
      people: [...withInLaw.people, person("greatgrand"), person("bride2"), person("bride2-father")],
    };
    const deep2: FamilyTree = {
      ...deep,
      relationships: [
        ...deep.relationships,
        { id: "s3", fromPersonId: "bride2", toPersonId: "grandchild", type: "spouse" },
        { id: "p12", fromPersonId: "bride2-father", toPersonId: "bride2", type: "parent" },
        { id: "p13", fromPersonId: "bride2", toPersonId: "greatgrand", type: "parent" },
      ],
    };
    const layout2 = buildFamilyLayout(deep2);
    expect(layout2.primaryParent.get("greatgrand")).toBe("grandchild");
    const gens2 = buildGenerations(deep2);
    expect(gens2.depth.get("bride2-father")).toBe(1);
  });

  it("places a married-in spouse beside their partner instead of the top row", () => {
    const withSpouse: FamilyTree = {
      people: [...tree.people, person("daughter-in-law"), person("grandchild2")],
      relationships: [
        ...tree.relationships,
        { id: "s1", fromPersonId: "daughter-in-law", toPersonId: "son", type: "spouse" },
        { id: "p6", fromPersonId: "son", toPersonId: "grandchild2", type: "parent" },
        { id: "p7", fromPersonId: "daughter-in-law", toPersonId: "grandchild2", type: "parent" },
      ],
      stories: [],
    };
    const result = buildGenerations(withSpouse);
    expect(result.depth.get("daughter-in-law")).toBe(1);
    expect(result.depth.get("grandchild2")).toBe(2);
    expect(result.depth.get("mother")).toBe(0);
  });
});
