import { describe, expect, it } from "vitest";
import { buildGedcom } from "../lib/gedcom";
import { parseGedcom, parseGedcomDate } from "../lib/gedcom-import";
import type { FamilyTree } from "../lib/types";

describe("deterministic GEDCOM import", () => {
  it("parses people, events, notes, spouses, and parents without a model", () => {
    const report = parseGedcom(`0 HEAD\n1 GEDC\n2 VERS 7.0\n0 @I1@ INDI\n1 NAME Jane /Doe/\n1 SEX F\n1 BIRT\n2 DATE 2 JAN 1980\n2 PLAC Paris, France\n1 NOTE First line\n2 CONT Second line\n0 @I2@ INDI\n1 NAME John /Doe/\n1 SEX M\n0 @I3@ INDI\n1 NAME Alex /Doe/\n0 @F1@ FAM\n1 HUSB @I2@\n1 WIFE @I1@\n1 CHIL @I3@\n0 TRLR\n`);
    expect(report).toMatchObject({ version: "7.0", people: 3, families: 1, relationships: 3, warnings: [] });
    expect(report.proposals[0]).toMatchObject({ kind: "add_person", person: { displayName: "Jane Doe", birthDate: "1980-01-02", birthCity: "Paris", birthCountry: "France", biography: "First line\nSecond line" } });
    expect(report.proposals.filter((proposal) => proposal.kind === "add_relationship")).toHaveLength(3);
  });

  it("round-trips supported facts and links from the archive exporter", () => {
    const tree: FamilyTree = { people: [
      { id: "p1", displayName: "Jane Doe", gender: "female", givenName: "Jane", familyName: "Doe", maidenName: null, birthDate: "1980-01-02", deathDate: null, birthPlace: null, deathPlace: null, birthCity: "Paris", birthCountry: "France", deathCity: null, deathCountry: null, burialPlace: null, residence: "London", biography: "A note", photoAttachmentId: null },
      { id: "p2", displayName: "Alex Doe", gender: null, givenName: "Alex", familyName: "Doe", maidenName: null, birthDate: "2010", deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null },
    ], relationships: [{ id: "r1", fromPersonId: "p1", toPersonId: "p2", type: "parent" }], stories: [] };
    const report = parseGedcom(buildGedcom(tree));
    expect(report.people).toBe(2); expect(report.relationships).toBe(1);
    expect(report.proposals[0]).toMatchObject({ kind: "add_person", person: { birthDate: "1980-01-02", residence: "London", biography: "A note" } });
  });

  it("keeps qualified dates instead of inventing precision", () => expect(parseGedcomDate("ABT 1900")).toBe("ABT 1900"));
});
