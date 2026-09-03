import { describe, expect, it } from "vitest";
import { MutationInvariants } from "../db/mutation-invariants";
import type { FamilyTree, Person, Relationship } from "../lib/types";

const person = (id: string, displayName = id): Person => ({
  id, displayName, gender: null, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null,
  birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null,
  biography: null, photoAttachmentId: null,
});

const state = (relationships: Relationship[] = []): FamilyTree => ({
  people: ["a", "b", "c", "d"].map((id) => person(id)),
  relationships,
  stories: [{ id: "story", title: "Story", body: "Text", date: null, place: null, personIds: [] }],
});

describe("runtime mutation invariants", () => {
  it("requires relationship endpoints and prevents self-links", () => {
    expect(() => new MutationInvariants(state()).addRelationship("missing", "b", "parent"))
      .toThrow("A referenced person no longer exists.");
    expect(() => new MutationInvariants(state()).addRelationship("a", "a", "spouse"))
      .toThrow("A person cannot be related to themself.");
  });

  it("rejects duplicate relationships and reverse spouse links", () => {
    const relationships: Relationship[] = [{ id: "spouse", fromPersonId: "a", toPersonId: "b", type: "spouse" }];
    expect(() => new MutationInvariants(state(relationships)).addRelationship("a", "b", "spouse"))
      .toThrow("That relationship already exists.");
    expect(() => new MutationInvariants(state(relationships)).addRelationship("b", "a", "spouse"))
      .toThrow("That spouse relationship already exists.");
  });

  it("allows two parents but rejects a third, including within one batch", () => {
    const invariants = new MutationInvariants(state([
      { id: "p1", fromPersonId: "a", toPersonId: "d", type: "parent" },
    ]));
    invariants.addRelationship("b", "d", "parent");
    expect(() => invariants.addRelationship("c", "d", "parent"))
      .toThrow("A person cannot have more than two recorded parents.");
  });

  it("rejects direct and transitive parent cycles", () => {
    const invariants = new MutationInvariants(state());
    invariants.addRelationship("a", "b", "parent");
    invariants.addRelationship("b", "c", "parent");
    expect(() => invariants.addRelationship("c", "a", "parent"))
      .toThrow("That parent relationship would create a cycle.");
  });

  it("requires relationship, story, and story-person mutation targets", () => {
    const invariants = new MutationInvariants(state(), ["attachment"]);
    expect(() => invariants.person("missing")).toThrow("That person is no longer in the tree.");
    expect(() => invariants.relationship("missing")).toThrow("That relationship no longer exists.");
    expect(() => invariants.story("missing")).toThrow("That story no longer exists.");
    expect(() => invariants.storyPeople(["a", "missing"])).toThrow("A person linked to that story no longer exists.");
    expect(() => invariants.storyAttachments(["attachment", "missing"])).toThrow("An attachment linked to that story no longer exists.");
    expect(() => invariants.person("a")).not.toThrow();
    expect(() => invariants.story("story")).not.toThrow();
    expect(() => invariants.storyPeople(["a", "b"])).not.toThrow();
    expect(() => invariants.storyAttachments(["attachment"])).not.toThrow();
  });

  it("resolves relationship-hint names only when the current-tree match is unique", () => {
    const tree = state();
    tree.people = [person("a", "Unique Name"), person("b", "Duplicate Name"), person("c", "duplicate name")];
    const invariants = new MutationInvariants(tree);
    expect(invariants.personIdByUniqueName(" unique name ")).toBe("a");
    expect(invariants.personIdByUniqueName("Missing Name")).toBeNull();
    expect(() => invariants.personIdByUniqueName("Duplicate Name"))
      .toThrow("More than one person is named Duplicate Name.");
  });
});
