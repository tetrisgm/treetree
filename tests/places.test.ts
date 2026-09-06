import { describe, expect, it } from "vitest";
import { canonicalCity, canonicalCountry, placeLabel, sameCity } from "../lib/places";
import { mapFamilyPlaces } from "../lib/archive-views";
import { buildFamilyStats } from "../lib/family-stats";
import { familyOrigins } from "../lib/family-answers";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, fields: Partial<Person>): Person => ({ id, displayName: id, gender: null, givenName: id, familyName: null, maidenName: null, birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null, ...fields });

describe("place spellings", () => {
  it("folds the transliterations of one Persian town into one name", () => {
    for (const spelling of ["Qazvin", "Ghazvin", "ghazvin ", "Kazvin", "قزوین"]) expect(canonicalCity(spelling)).toBe("Qazvin");
    for (const spelling of ["Tehran", "Teheran", "Theran", "تهران"]) expect(canonicalCity(spelling)).toBe("Tehran");
    expect(sameCity("Ghazvin", "Qazvin")).toBe(true);
    expect(sameCity("Qazvin", "Tehran")).toBe(false);
  });
  it("leaves an unknown town as typed, trimmed", () => {
    expect(canonicalCity("  Bandar Anzali ")).toBe("Bandar Anzali");
    expect(canonicalCity("")).toBeNull();
    expect(canonicalCountry("Persia")).toBe("Iran");
  });
  it("canonicalises a free-text place piecewise", () => {
    expect(placeLabel(null, null, "Ghazvin, Iran")).toBe("Qazvin, Iran");
    expect(placeLabel(null, null, "Darab, Fars Province, Iran")).toBe("Darab, Fars Province, Iran");
    expect(placeLabel("Theran", "Persia")).toBe("Tehran, Iran");
  });
  it("counts, maps and narrates every spelling as one place", () => {
    const tree: FamilyTree = { people: [
      person("a", { birthCity: "Ghazvin", birthCountry: "Iran", birthDate: "1900" }),
      person("b", { birthCity: "Qazvin", birthDate: "1930" }),
      person("c", { birthPlace: "Qazvin, Iran", birthDate: "1960" }),
      person("d", { birthCity: "Theran", birthDate: "1962" }),
    ], relationships: [{ id: "r1", fromPersonId: "a", toPersonId: "b", type: "parent" }, { id: "r2", fromPersonId: "b", toPersonId: "c", type: "parent" }], stories: [] };
    const { mapped, unmapped } = mapFamilyPlaces(tree);
    expect(unmapped).toEqual([]);
    expect(mapped.map((place) => `${place.label}:${place.people.length}`)).toEqual(["Qazvin, Iran:3", "Tehran:1"]);
    expect(buildFamilyStats(tree).places).toEqual([{ label: "Qazvin", count: 2 }, { label: "Tehran", count: 1 }]);
    const origins = familyOrigins(tree);
    expect(origins).toContain("Qazvin, Iran (1)");
    expect(origins).not.toMatch(/Ghazvin|Theran/);
  });
});
