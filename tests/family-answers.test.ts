import { describe, expect, it } from "vitest";
import { familyInYear, familyOrigins, kinshipToEgo, lifeStory, namesakes, upcomingDates } from "../lib/family-answers";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName: string, extra: Partial<Person> = {}): Person => ({
  id, displayName, gender: null, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null,
  birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null,
  biography: null, photoAttachmentId: null, ...extra,
});

// three generations: Bahram (Qazvin) -> Farhad (Tehran) -> Roya (Paris)
const tree: FamilyTree = {
  people: [
    person("g1", "Bahram Golestani", { birthDate: "1900", deathDate: "1975-03-10", birthCity: "Qazvin", birthCountry: "Iran", gender: "male" }),
    person("p1", "Farhad Golestani", { birthDate: "1940-02-01", birthCity: "Tehran", birthCountry: "Iran", gender: "male" }),
    person("p2", "Mina Golestani", { gender: "female" }),
    person("p3", "Roya Golestani", { birthDate: "1972-06-15", birthCity: "Paris", birthCountry: "France", gender: "female" }),
    person("p4", "Bahram Karimi", { birthDate: "1998" }),
  ],
  relationships: [
    { id: "r0", fromPersonId: "g1", toPersonId: "p1", type: "parent", status: null },
    { id: "r1", fromPersonId: "p1", toPersonId: "p2", type: "spouse", status: "married" },
    { id: "r2", fromPersonId: "p1", toPersonId: "p3", type: "parent", status: null },
    { id: "r3", fromPersonId: "p2", toPersonId: "p3", type: "parent", status: null },
  ],
  stories: [{ id: "s1", title: "The move to Paris", body: "A story.", originalBody: null, date: "1970", place: "Paris", personIds: ["p1"], attachmentIds: [] }],
};

describe("family answers", () => {
  it("answers how-am-I-related from the asker's point of view", () => {
    expect(kinshipToEgo(tree, "p3", "g1")).toContain("your");
    expect(kinshipToEgo(tree, "p3", "g1")).toMatch(/grandfather/);
    expect(kinshipToEgo(tree, "p3", "p3")).toBe("That is you.");
    expect(kinshipToEgo(tree, null, "g1")).toContain("does not know which person");
  });

  it("tells a life in order rather than dumping fields", () => {
    const story = lifeStory(tree, "p1");
    expect(story).toContain("was born in 1940");
    expect(story).toContain("Bahram Golestani");
    expect(story).toContain("married Mina Golestani");
    expect(story).toContain("Roya Golestani");
    expect(story).toContain("The move to Paris");
  });

  it("reads origins as movement, oldest generation first", () => {
    const origins = familyOrigins(tree);
    expect(origins.indexOf("Qazvin")).toBeLessThan(origins.indexOf("Paris"));
  });

  it("snapshots a year, counting only dated records and saying so", () => {
    const snapshot = familyInYear(tree, 1972);
    expect(snapshot).toContain("Born in 1972: Roya Golestani");
    expect(snapshot).toContain("Bahram Golestani");
    expect(snapshot).toContain("Only people with recorded years");
  });

  it("finds namesakes across generations, eldest first", () => {
    const result = namesakes(tree, "Bahram");
    expect(result).toContain("2 people");
    expect(result.indexOf("Bahram Golestani")).toBeLessThan(result.indexOf("Bahram Karimi"));
  });

  it("lists upcoming full-dated birthdays and anniversaries only", () => {
    // pick 'today' just before Roya's birthday; Bahram's bare-year birth is excluded
    const result = upcomingDates(tree, new Date(Date.UTC(2026, 5, 10)));
    expect(result).toContain("Roya Golestani's birthday");
    expect(result).not.toContain("Bahram Karimi");
  });
});

import { intentContext } from "../lib/family-answers";

describe("intent context for the archivist", () => {
  it("names the asker and precomputes their kinship to mentioned people", () => {
    const context = intentContext(tree, "How am I related to Bahram Golestani?", "p3");
    expect(context).toContain("The person asking is Roya Golestani");
    expect(context).toMatch(/the asker's (great-)?grandfather/);
  });

  it("snapshots years written in Persian digits", () => {
    const context = intentContext(tree, "خانواده در سال ۱۹۷۲ چطور بود؟", null);
    expect(context).toContain("The family in 1972 (computed)");
    expect(context).toContain("Roya Golestani");
  });

  it("always carries origins and upcoming dates as computed blocks", () => {
    const context = intentContext(tree, "hello", null);
    expect(context).toContain("Family origins (computed)");
    expect(context).toContain("Dates this month (computed)");
    expect(context).not.toContain("The person asking");
  });
});
