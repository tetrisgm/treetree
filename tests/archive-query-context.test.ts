import { describe, expect, it } from "vitest";
import { archiveQueryRelationships, peopleMentionedInArchiveText } from "../lib/archive-query-context";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName: string, givenName: string): Person => ({
  id, displayName, givenName, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null,
  birthCity: null, birthCountry: null, deathCity: null, deathCountry: null,
  burialPlace: null, residence: null, biography: null, photoAttachmentId: null,
});

const tree: FamilyTree = {
  people: [
    person("ali-d", "Ali Golestani", "Ali"),
    person("ali-j", "Ali Jaberian", "Ali"),
    person("sara", "Sara Jaberian", "Sara"),
  ],
  relationships: [
    { id: "parent", fromPersonId: "ali-j", toPersonId: "sara", type: "parent" },
  ],
  stories: [],
};

describe("archive query context", () => {
  it("prefers an exact full name over every person sharing a given name", () => {
    expect(peopleMentionedInArchiveText(tree, "Tell me about Ali Jaberian"))
      .toEqual([tree.people[1]]);
  });

  it("keeps a given-name-only query ambiguous instead of choosing a cousin", () => {
    expect(peopleMentionedInArchiveText(tree, "Who is Ali?"))
      .toEqual([tree.people[0], tree.people[1]]);
  });

  it("matches normalized Unicode names across casing and punctuation", () => {
    expect(peopleMentionedInArchiveText(tree, "SARA, JABERIAN's father"))
      .toEqual([tree.people[2]]);
  });

  it("computes relationships once names have been resolved", () => {
    expect(archiveQueryRelationships(tree, "How are Ali Jaberian and Sara Jaberian related?").relationships)
      .toEqual(["Sara Jaberian is Ali Jaberian's child."]);
  });
});
