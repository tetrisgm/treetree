import { describe, expect, it } from "vitest";
import { reconcileProposals } from "../lib/agent-reconcile";
import type { AddPersonProposal, FamilyTree, Person } from "../lib/types";

const person = (overrides: Partial<Person>): Person => ({ id: "p1", displayName: "Farhad Golestani", givenName: null, familyName: null, maidenName: null, birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null, ...overrides });
const incoming = (overrides: Partial<Omit<Person, "id">> = {}): AddPersonProposal => {
  const basePerson = person({});
  const base: Omit<Person, "id"> = { displayName: basePerson.displayName, givenName: basePerson.givenName, familyName: basePerson.familyName, maidenName: basePerson.maidenName, birthDate: basePerson.birthDate, deathDate: basePerson.deathDate, birthPlace: basePerson.birthPlace, deathPlace: basePerson.deathPlace, birthCity: basePerson.birthCity, birthCountry: basePerson.birthCountry, deathCity: basePerson.deathCity, deathCountry: basePerson.deathCountry, burialPlace: null, residence: null, biography: basePerson.biography, photoAttachmentId: basePerson.photoAttachmentId };
  return { kind: "add_person", summary: "Imported Farhad", person: { ...base, birthDate: "1940", ...overrides } };
};

describe("agent reconciliation", () => {
  it("merges an unambiguous overlap instead of creating a duplicate", () => {
    const tree: FamilyTree = { people: [person({ birthCity: "Tehran" })], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming()]);
    expect(result.conflicts).toEqual([]);
    expect(result.proposals[0]).toMatchObject({ kind: "update_person", personId: "p1", patch: { birthDate: "1940", birthCity: "Tehran" } });
  });

  it("keeps facts the incoming record is simply silent about", () => {
    // an update proposal rewrites every column, so a field the merge drops is
    // a field the archive loses
    const tree: FamilyTree = { people: [person({ burialPlace: "Qazvin cemetery", residence: "Tehran, Iran" })], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming()]);
    expect(result.proposals[0]).toMatchObject({ kind: "update_person", patch: { burialPlace: "Qazvin cemetery", residence: "Tehran, Iran" } });
  });

  it("asks only when identity evidence conflicts", () => {
    const tree: FamilyTree = { people: [person({ birthDate: "1938" })], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ birthDate: "1940" })]);
    expect(result.proposals).toEqual([]);
    expect(result.conflicts[0].candidatePersonIds).toEqual(["p1"]);
  });

  it("collapses duplicate people within one import batch", () => {
    const tree: FamilyTree = { people: [], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ birthCity: "Tehran" }), incoming({ biography: "Family notes" })]);
    expect(result.conflicts).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ kind: "add_person", person: { birthDate: "1940", birthCity: "Tehran", biography: "Family notes" } });
  });

  it("does not collapse different Persian names", () => {
    const tree: FamilyTree = { people: [person({ displayName: "علی رضایی" })], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ displayName: "مریم احمدی" })]);
    expect(result.conflicts).toEqual([]);
    expect(result.proposals).toEqual([expect.objectContaining({ kind: "add_person", person: expect.objectContaining({ displayName: "مریم احمدی" }) })]);
  });

  it("keeps different Persian names separate within one import batch", () => {
    const tree: FamilyTree = { people: [], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ displayName: "علی رضایی" }), incoming({ displayName: "مریم احمدی" })]);
    expect(result.conflicts).toEqual([]);
    expect(result.proposals).toHaveLength(2);
  });

  it("matches Persian names written with Arabic Yeh and Kaf variants", () => {
    const tree: FamilyTree = { people: [person({ displayName: "علي كاظمي" })], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ displayName: "علی کاظمی" })]);
    expect(result.conflicts).toEqual([]);
    expect(result.proposals[0]).toMatchObject({ kind: "update_person", personId: "p1" });
  });

  it("does not conflate Arabic Alef Maksura with Yeh", () => {
    const tree: FamilyTree = { people: [person({ displayName: "هدى" })], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ displayName: "هدي" })]);
    expect(result.conflicts).toEqual([]);
    expect(result.proposals[0]).toMatchObject({ kind: "add_person", person: { displayName: "هدي" } });
  });

  it("detects conflicting Persian identity values", () => {
    const tree: FamilyTree = { people: [person({ displayName: "علی رضایی", birthCity: "تهران" })], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ displayName: "علی رضایی", birthCity: "قزوین" })]);
    expect(result.proposals).toEqual([]);
    expect(result.conflicts[0]).toMatchObject({ candidatePersonIds: ["p1"], reason: "The incoming identity fields conflict with the existing record." });
  });

  it("matches identity years written with Persian numerals", () => {
    const tree: FamilyTree = { people: [person({ displayName: "علی رضایی", birthDate: "۱۹۴۰" })], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ displayName: "علی رضایی", birthDate: "1940" })]);
    expect(result.conflicts).toEqual([]);
    expect(result.proposals[0]).toMatchObject({ kind: "update_person", personId: "p1" });
  });

  it("does not use an empty canonical name as a deduplication key", () => {
    const tree: FamilyTree = { people: [], relationships: [], stories: [] };
    const result = reconcileProposals(tree, [incoming({ displayName: "—" }), incoming({ displayName: "…" })]);
    expect(result.conflicts).toEqual([]);
    expect(result.proposals).toHaveLength(2);
  });
});
