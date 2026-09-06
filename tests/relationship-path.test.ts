import { describe, expect, it } from "vitest";
import { createRelationshipDescriber, describeRelationship, kinshipMap, relationshipSentence, shortKinship } from "../lib/relationship-path";
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
    expect(rel("me", "gf")).toBe("paternal grandfather");
    expect(rel("gf", "me")).toBe("grandson");
    expect(rel("cousKid", "gf")).toBe("maternal great-grandfather");
  });

  it("names siblings, aunts, uncles and nephews", () => {
    expect(rel("me", "sis")).toBe("sister");
    expect(rel("me", "u")).toBe("paternal uncle");
    expect(rel("u", "me")).toBe("nephew");
    expect(rel("gf", "cousKid")).toBe("great-granddaughter");
  });

  it("counts cousins and how far removed they are", () => {
    expect(rel("me", "cous")).toBe("first cousin");
    expect(rel("me", "cousKid")).toBe("first cousin once removed");
  });

  it("handles marriage and unconnected people", () => {
    expect(rel("me", "wife")).toBe("wife");
    expect(rel("me", "aunt")).toBe("paternal uncle's wife");
    expect(rel("me", "stranger")).toBe("not connected in the records");
  });

  it("writes a sentence naming the shared ancestors", () => {
    const result = describeRelationship(tree, "me", "cous")!;
    expect(relationshipSentence(result)).toBe("Cousin is Me's first cousin. They share Grandfather and Grandmother.");
  });

  it("does not claim a direct ancestor is shared with himself", () => {
    expect(relationshipSentence(describeRelationship(tree, "me", "gf")!)).toBe("Grandfather is Me's paternal grandfather.");
  });

  it("reuses one graph index when describing several pairs", () => {
    const describe = createRelationshipDescriber(tree);
    expect(describe("me", "cous")?.relationship).toBe("first cousin");
    expect(describe("me", "wife")?.relationship).toBe("wife");
    expect(describe("me", "stranger")?.relationship).toBe("not connected in the records");
  });
});

describe("kinship tags", () => {
  it("names the people who married in, rather than calling them all the same thing", () => {
    // the fixture's Aunt is the wife of Me's paternal uncle
    expect(kinshipMap(tree, "me").get("aunt")).toBe("your paternal uncle's wife");
    expect(kinshipMap(tree, "aunt").get("me")).toBe("your husband's nephew");
  });
  it("labels every person from the viewer's seat", () => {
    const tags = kinshipMap(tree, "me");
    expect(tags.get("f")).toBe("your father");
    expect(tags.get("u")).toBe("your paternal uncle");
    expect(tags.get("gf")).toBe("your paternal grandfather");
    expect(tags.get("cous")).toBe("your first cousin");
    expect(tags.get("wife")).toBe("your wife");
    expect(tags.get("me")).toBe("you");
    expect(tags.has("stranger")).toBe(false);
  });
  it("labels from a selected person's seat when the viewer is unknown", () => {
    const tags = kinshipMap(tree, "cous", "her");
    expect(tags.get("u")).toBe("her father");
    expect(tags.get("me")).toBe("her first cousin");
    expect(tags.has("cous")).toBe(false);
  });
  it("labels nobody when the viewer has not said who they are", () => {
    expect(kinshipMap(tree, null).size).toBe(0);
    expect(kinshipMap(tree, "nobody").size).toBe(0);
    expect(shortKinship(null)).toBeNull();
  });
});

describe("sides and the family's own words", () => {
  it("names the side of the family for uncles and grandparents", () => {
    expect(rel("me", "u")).toBe("paternal uncle");
    expect(rel("me", "gf")).toBe("paternal grandfather");
    expect(rel("me", "gm")).toBe("paternal grandmother");
    expect(describeRelationship(tree, "me", "cous")?.side).toBe("paternal");
    expect(describeRelationship(tree, "me", "cous")?.viaTheirs?.id).toBe("u");
    expect(describeRelationship(tree, "u", "me")?.viaTheirs?.id).toBe("f");
    expect(rel("me", "f")).toBe("father");
    expect(rel("me", "sis")).toBe("sister");
  });
  it("speaks Persian and French from the same result", async () => {
    const { kinshipLabel } = await import("../lib/kinship-words");
    const label = (a: string, b: string, lang: "en" | "fa" | "fr") => kinshipLabel(describeRelationship(tree, a, b), lang);
    expect(label("me", "u", "fa")).toBe("عموی شما");
    expect(label("me", "aunt", "fa")).toBe("زن عموی شما");
    expect(label("me", "cous", "fa")).toBe("دخترعموی شما");
    expect(kinshipLabel(describeRelationship(tree, "u", "me"), "fa", "his")).toBe("برادرزاده‌ی او");
    expect(label("me", "gf", "fr")).toBe("votre grand-père paternel");
    expect(label("me", "cous", "fr")).toBe("votre cousine germaine");
    expect(label("me", "u", "en")).toBe("your paternal uncle");
    expect(label("me", "aunt", "fr")).toBe("la femme de votre oncle paternel");
  });
});

describe("in-laws by name", () => {
  const inLawTree: FamilyTree = {
    people: [
      person("me", "Me", "male"), person("wife", "Wife", "female"),
      person("son", "Son", "male"), person("sonWife", "Son's wife", "female"),
      person("sis", "Sister", "female"), person("sisHusband", "Sister's husband", "male"),
      person("wifeMother", "Wife's mother", "female"), person("wifeBrother", "Wife's brother", "male"),
      person("mum", "Mother", "female"),
    ],
    relationships: [
      spouse("me", "wife"), parent("me", "son"), spouse("son", "sonWife"),
      parent("mum", "me"), parent("mum", "sis"), spouse("sis", "sisHusband"),
      parent("wifeMother", "wife"), parent("wifeMother", "wifeBrother"),
    ],
    stories: [],
  };
  const term = (from: string, to: string) => describeRelationship(inLawTree, from, to)?.relationship;
  it("uses the English word for each kind of in-law", () => {
    expect(term("me", "sonWife")).toBe("daughter-in-law");
    expect(term("sonWife", "me")).toBe("father-in-law");
    expect(term("me", "wifeMother")).toBe("mother-in-law");
    expect(term("me", "wifeBrother")).toBe("brother-in-law");
    expect(term("me", "sisHusband")).toBe("brother-in-law");
    expect(term("sisHusband", "me")).toBe("brother-in-law");
  });
  it("does not call a blood relative an in-law", () => {
    expect(term("me", "son")).toBe("son");
    expect(term("me", "sis")).toBe("sister");
    expect(term("me", "mum")).toBe("mother");
  });
  it("speaks the in-laws in Persian, where the word depends on whose family they are", async () => {
    const { kinshipLabel } = await import("../lib/kinship-words");
    // a man's mother-in-law is مادرزن; a woman's is مادرشوهر
    expect(kinshipLabel(describeRelationship(inLawTree, "me", "wifeMother"), "fa")).toBe("مادرزن شما");
    expect(kinshipLabel(describeRelationship(inLawTree, "sonWife", "me"), "fa")).toBe("پدرشوهر شما");
    expect(kinshipLabel(describeRelationship(inLawTree, "me", "sonWife"), "fr")).toBe("votre belle-fille");
  });
});
