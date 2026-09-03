import { describe, expect, it } from "vitest";
import { buildTimeline, mapFamilyPlaces } from "../lib/archive-views";
import type { FamilyTree, Person } from "../lib/types";

const person: Person = { id: "p1", displayName: "Leila Sharifi", givenName: "Roya", maidenName: null, familyName: "Golestani", birthDate: "1981-03-02", deathDate: null, birthPlace: null, deathPlace: null, birthCity: "Paris", birthCountry: "France", deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null };
const tree: FamilyTree = { people: [person], relationships: [], stories: [{ id: "s1", title: "A family day", body: "A memory", date: "2000", place: "Paris", personIds: [person.id] }] };

describe("archive views", () => {
  it("orders dated life events and stories", () => {
    expect(buildTimeline(tree).map((event) => event.id)).toEqual(["birth-p1", "story-s1"]);
  });

  it("groups people at structured map locations", () => {
    expect(mapFamilyPlaces(tree).mapped[0]).toMatchObject({ label: "Paris, France", people: [{ id: "p1" }] });
  });
});
