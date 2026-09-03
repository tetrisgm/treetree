import { describe, expect, it } from "vitest";
import { attachmentBelongsToLivingPerson, isLikelyLiving, redactLivingDetails } from "../lib/living-privacy";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, birthDate: string | null, deathDate: string | null): Person => ({ id, displayName: id, gender: null, givenName: id, familyName: null, maidenName: null, birthDate, deathDate, birthPlace: "Paris", deathPlace: null, birthCity: "Paris", birthCountry: "France", deathCity: null, deathCountry: null, burialPlace: null, residence: "London", biography: "Private life", photoAttachmentId: `${id}-photo`, photoIds: [`${id}-photo`] });

describe("living-person public privacy", () => {
  it("uses a conservative 120-year rule and honors recorded deaths", () => {
    expect(isLikelyLiving(person("living", "1980-01-02", null), 2026)).toBe(true);
    expect(isLikelyLiving(person("dead", "1980", "2020"), 2026)).toBe(false);
    expect(isLikelyLiving(person("undated", null, null), 2026)).toBe(false);
  });
  it("carries the root person through redaction - the landing view depends on it", () => {
    const redacted = redactLivingDetails({ people: [], relationships: [], stories: [], rootPersonId: "root-1" });
    expect(redacted.rootPersonId).toBe("root-1");
  });

  it("keeps the public graph while hiding living details, photos, and linked stories", () => {
    const tree: FamilyTree = { people: [person("living", "1980-01-02", null), person("ancestor", "1880", "1950")], relationships: [{ id: "r", fromPersonId: "ancestor", toPersonId: "living", type: "parent" }], stories: [{ id: "s", title: "Private", body: "Story", date: null, place: null, personIds: ["living"], attachmentIds: [] }] };
    const publicTree = redactLivingDetails(tree);
    expect(publicTree.relationships).toEqual(tree.relationships); expect(publicTree.stories).toEqual([]);
    expect(publicTree.people[0]).toMatchObject({ birthDate: "1980", birthCity: null, residence: null, biography: null, photoAttachmentId: null, photoIds: [] });
    expect(attachmentBelongsToLivingPerson(tree, "living-photo")).toBe(true);
  });
});
