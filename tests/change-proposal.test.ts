import { describe, expect, it } from "vitest";
import { isChangeProposal } from "../lib/change-proposal";

const person = {
  displayName: "Farhad Golestani",
  gender: "male",
  givenName: "Farhad",
  familyName: "Golestani",
  maidenName: null,
  birthDate: "1940",
  deathDate: null,
  birthPlace: null,
  deathPlace: null,
  birthCity: "Tehran",
  birthCountry: "Iran",
  deathCity: null,
  deathCountry: null,
  burialPlace: null,
  residence: null,
  biography: null,
  photoAttachmentId: null,
};

describe("change proposal validation", () => {
  it("accepts every supported proposal shape", () => {
    const proposals = [
      { kind: "add_person", summary: "Add Farhad", person, relationshipHints: [{ personName: "Mina Golestani", relationshipType: "spouse" }] },
      { kind: "update_person", summary: "Update Farhad", personId: "person-1", patch: person },
      { kind: "delete_person", summary: "Delete a duplicate", personId: "person-1" },
      { kind: "add_relationship", summary: "Add parent", fromPersonId: "person-1", toPersonId: "person-2", relationshipType: "parent" },
      { kind: "add_relationship", summary: "Resolve new people", fromPersonId: "", toPersonId: "", fromPersonName: "Farhad", toPersonName: "Roya", relationshipType: "parent" },
      { kind: "delete_relationship", summary: "Remove an incorrect link", relationshipId: "relationship-1" },
      { kind: "merge_people", summary: "Merge a duplicate", sourcePersonId: "person-duplicate", targetPersonId: "person-canonical" },
      { kind: "add_story", summary: "Add a story", title: "A memory", body: "Story text", date: null, place: null, personIds: ["person-1"], attachmentIds: [] },
      { kind: "update_story", summary: "Update a story", storyId: "story-1", title: "A memory", body: "Story text", date: "1983", place: "Paris", personIds: [], attachmentIds: ["attachment-1"] },
      { kind: "delete_story", summary: "Delete a duplicate story", storyId: "story-1" },
      { kind: "delete_attachment", summary: "Delete private evidence", attachmentId: "attachment-1" },
    ];
    for (const proposal of proposals) expect(isChangeProposal(proposal), proposal.kind).toBe(true);
  });

  it("rejects partial person updates that would erase omitted fields", () => {
    expect(isChangeProposal({ kind: "update_person", summary: "Update", personId: "person-1", patch: { displayName: "Farhad" } })).toBe(false);
  });

  it("rejects malformed relationships, links, and destructive targets", () => {
    expect(isChangeProposal({ kind: "add_relationship", summary: "Bad", fromPersonId: "", toPersonId: "person-2", relationshipType: "parent" })).toBe(false);
    expect(isChangeProposal({ kind: "add_relationship", summary: "Bad", fromPersonId: "person-1", toPersonId: "person-2", relationshipType: "sibling" })).toBe(false);
    expect(isChangeProposal({ kind: "delete_person", summary: "Bad", personId: "" })).toBe(false);
    expect(isChangeProposal({ kind: "merge_people", summary: "Bad", sourcePersonId: "same", targetPersonId: "same" })).toBe(false);
    expect(isChangeProposal({ kind: "add_story", summary: "Bad", title: "Story", body: "Text", date: null, place: null, personIds: [null], attachmentIds: [] })).toBe(false);
  });

  it("enforces bounded user and model text", () => {
    expect(isChangeProposal({ kind: "add_person", summary: "Add", person: { ...person, biography: "x".repeat(50_001) } })).toBe(false);
    expect(isChangeProposal({ kind: "add_story", summary: "Add", title: "Story", body: "x".repeat(200_001), date: null, place: null, personIds: [], attachmentIds: [] })).toBe(false);
    expect(isChangeProposal({ kind: "delete_story", summary: "x".repeat(501), storyId: "story-1" })).toBe(false);
  });

  it("bounds mutation fan-out before it can exceed D1 invocation limits", () => {
    const ids = Array.from({ length: 33 }, (_, index) => `person-${index}`);
    expect(isChangeProposal({ kind: "add_story", summary: "Add", title: "Story", body: "Text", date: null, place: null, personIds: ids.slice(0, 16), attachmentIds: ids.slice(16, 32) })).toBe(true);
    expect(isChangeProposal({ kind: "add_story", summary: "Add", title: "Story", body: "Text", date: null, place: null, personIds: ids, attachmentIds: [] })).toBe(false);
    expect(isChangeProposal({ kind: "add_person", summary: "Add", person, relationshipHints: Array.from({ length: 17 }, () => ({ personName: "Relative", relationshipType: "parent" })) })).toBe(false);
  });
});
