import { describe, expect, it } from "vitest";
import { buildFamilyLayout, buildGenerations, foldBranches } from "../lib/tree-layout";
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

describe("where a married person stands", () => {
  /* The reference archive's own shape: two brothers, each married. One wife
     married in with no parents recorded; the other has a father in the tree,
     in a branch of her own. */
  const family: FamilyTree = {
    people: ["patriarch", "brotherA", "brotherB", "wifeA", "wifeB", "wifeBFather", "wifeBSister", "grandchild"].map((id) =>
      ({ id, displayName: id, gender: id.startsWith("wife") ? "female" : "male", givenName: id, familyName: null, maidenName: null, birthDate: "1900", deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null })),
    relationships: [
      { id: "r1", fromPersonId: "patriarch", toPersonId: "brotherA", type: "parent", status: null },
      { id: "r2", fromPersonId: "patriarch", toPersonId: "brotherB", type: "parent", status: null },
      { id: "r3", fromPersonId: "brotherA", toPersonId: "wifeA", type: "spouse", status: null },
      // recorded the other way round, as half this archive's marriages are
      { id: "r4", fromPersonId: "wifeB", toPersonId: "brotherB", type: "spouse", status: null },
      { id: "r5", fromPersonId: "wifeBFather", toPersonId: "wifeB", type: "parent", status: null },
      { id: "r6", fromPersonId: "wifeBFather", toPersonId: "wifeBSister", type: "parent", status: null },
      { id: "r7", fromPersonId: "brotherA", toPersonId: "grandchild", type: "parent", status: null },
    ],
    stories: [],
  };
  const childrenByParent = (layout: ReturnType<typeof buildFamilyLayout>) => {
    const map = new Map<string, string[]>();
    for (const [child, parent] of layout.primaryParent) {
      const kids = map.get(parent);
      if (kids) kids.push(child); else map.set(parent, [child]);
    }
    return map;
  };
  const full = buildFamilyLayout(family);
  const primaryChildren = childrenByParent(full);

  it("keeps someone with a family here in their parents' row, beside their sister", () => {
    // her father's children are both his, and neither is pulled away to a spouse
    expect((primaryChildren.get("wifeBFather") ?? []).sort()).toEqual(["wifeB", "wifeBSister"]);
    expect(full.drawnBeside.has("wifeB")).toBe(false);
    // the one who married in has no row of her own, so she stands in his
    expect(full.drawnBeside.get("wifeA")).toBe("brotherA");
  });

  it("stands her beside her husband while her own family is folded away", () => {
    const { visibleTree, visibleSet } = foldBranches(family, full, primaryChildren, new Set(["wifeBFather"]));
    expect(visibleSet.has("wifeB")).toBe(true);
    expect(visibleSet.has("wifeBSister")).toBe(false);
    // the canvas lays out what is on screen, and there she has no family of
    // her own, so she joins her husband's row
    const onScreen = buildFamilyLayout(visibleTree);
    expect(onScreen.drawnBeside.get("wifeB")).toBe("brotherB");
  });

  it("takes a wife away with the husband she was only ever beside", () => {
    const { visibleSet } = foldBranches(family, full, primaryChildren, new Set(["patriarch"]));
    expect(visibleSet.has("patriarch")).toBe(true);
    // she married in and had no row of her own, so she goes where he goes
    expect(visibleSet.has("brotherA")).toBe(false);
    expect(visibleSet.has("wifeA")).toBe(false);
    /* He does keep his place at his wife's side, because her family is on
       screen and a couple is not split by whichever branch is folded. */
    expect(visibleSet.has("wifeB")).toBe(true);
    expect(visibleSet.has("brotherB")).toBe(true);
  });

  it("promises the family, and opening the branch seats exactly that many in it", () => {
    const folded = foldBranches(family, full, primaryChildren, new Set(["wifeBFather"]));
    const opened = foldBranches(family, full, primaryChildren, new Set());
    const seatedUnder = (tree: FamilyTree, parent: string) => {
      const scene = buildFamilyLayout(tree);
      return [...scene.primaryParent].filter(([, owner]) => owner === parent).map(([child]) => child);
    };
    const before = seatedUnder(folded.visibleTree, "wifeBFather");
    const after = seatedUnder(opened.visibleTree, "wifeBFather");
    // both daughters are in his row once it is open - the married one has
    // come back from her husband's side - and the chip said so
    expect(after.sort()).toEqual(["wifeB", "wifeBSister"]);
    expect(folded.hiddenCounts.get("wifeBFather")).toBe(after.length - before.length);
  });
})
