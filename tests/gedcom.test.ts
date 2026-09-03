import { describe, expect, it } from "vitest";
import { buildGedcom } from "../lib/gedcom";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName: string, extra: Partial<Person> = {}): Person => ({
  id, displayName, gender: null, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null,
  birthCity: null, birthCountry: null, deathCity: null, deathCountry: null,
  burialPlace: null, residence: null, biography: null, photoAttachmentId: null, ...extra,
});

const tree: FamilyTree = {
  people: [
    person("f", "Mohammad Zehtab Golestani", { gender: "male", birthDate: "1856", deathDate: "1939-04-02", birthCity: "Qazvin", birthCountry: "Iran", burialPlace: "Qazvin cemetery", residence: "Tehran, Iran" }),
    person("m", "Salmeh", { gender: "female" }),
    person("c", "Hossein Zehtab Golestani", { gender: "male", birthDate: "1882", biography: "Ran the company." }),
  ],
  relationships: [
    { id: "r1", fromPersonId: "f", toPersonId: "c", type: "parent", status: null },
    { id: "r2", fromPersonId: "m", toPersonId: "c", type: "parent", status: null },
    { id: "r3", fromPersonId: "f", toPersonId: "m", type: "spouse", status: null },
  ],
  stories: [{ id: "s", title: "A day's hunting", body: "One Friday in winter.", date: "1906", place: null, personIds: ["c"] }],
};

describe("gedcom export", () => {
  const text = buildGedcom(tree);

  it("opens and closes a valid lineage-linked file", () => {
    expect(text.startsWith("0 HEAD")).toBe(true);
    expect(text.trimEnd().endsWith("0 TRLR")).toBe(true);
    expect(text).toContain("2 VERS 5.5.1");
  });

  it("exports where a person lived as a residence event", () => {
    expect(text).toContain("1 RESI");
    expect(text).toContain("2 PLAC Tehran, Iran");
  });

  it("writes names, sex, dates and places", () => {
    expect(text).toContain("1 NAME Mohammad /Zehtab Golestani/");
    expect(text).toContain("1 SEX M");
    expect(text).toContain("2 DATE 1856");
    expect(text).toContain("2 DATE 2 APR 1939");
    expect(text).toContain("2 PLAC Qazvin, Iran");
    expect(text).toContain("1 BURI");
  });

  it("puts the couple and their child in one family", () => {
    expect(text).toContain("1 HUSB @I1@");
    expect(text).toContain("1 WIFE @I2@");
    expect(text).toContain("1 CHIL @I3@");
    expect(text.match(/^0 @F\d+@ FAM$/gm)).toHaveLength(1);
  });

  it("carries biographies and the stories a person appears in", () => {
    expect(text).toContain("1 NOTE Ran the company.");
    expect(text).toContain("A day's hunting (1906)");
  });
});
