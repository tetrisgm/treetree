import { describe, expect, it } from "vitest";
import { familyGenerations, lifeStatus } from "../lib/life-status";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, extra: Partial<Person> = {}): Person => ({
  id, displayName: id, gender: null, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null,
  birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null,
  biography: null, photoAttachmentId: null, ...extra,
});

// four generations: a founder with no dates, down to a living child
const tree: FamilyTree = {
  people: [
    person("founder"), person("son"), person("grandson"), person("greatgrandson", { birthDate: "1983" }),
    person("buried", { burialPlace: "Qazvin cemetery" }), person("ancient", { birthDate: "1720" }),
  ],
  relationships: [
    { id: "r1", fromPersonId: "founder", toPersonId: "son", type: "parent", status: null },
    { id: "r2", fromPersonId: "son", toPersonId: "grandson", type: "parent", status: null },
    { id: "r3", fromPersonId: "grandson", toPersonId: "greatgrandson", type: "parent", status: null },
  ],
  stories: [],
};
const generations = familyGenerations(tree);
const at = new Date("2026-08-28");
const status = (id: string) => lifeStatus(tree.people.find((p) => p.id === id)!, generations, at);

describe("what the archive may say about a life", () => {
  it("calls a recorded death a death, however it was recorded", () => {
    expect(status("buried")).toBe("died");
  });

  it("does not read an absent death date as a life", () => {
    // the founder has no dates at all and sits three generations back
    expect(status("founder")).toBe("unknown");
    expect(status("son")).toBe("unknown");
  });

  it("presumes the last generations are living when nothing says otherwise", () => {
    expect(status("grandson")).toBe("living");
    expect(status("greatgrandson")).toBe("living");
  });

  it("will not call someone born in 1720 living", () => {
    expect(status("ancient")).toBe("unknown");
  });

  it("answers without the tree, from a birth year alone", () => {
    expect(lifeStatus(person("x", { birthDate: "1990" }), null, at)).toBe("living");
    expect(lifeStatus(person("x", { birthDate: "1850" }), null, at)).toBe("unknown");
    expect(lifeStatus(person("x"), null, at)).toBe("unknown");
  });
});
