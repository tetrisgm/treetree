import { describe, expect, it } from "vitest";
import { estimateBirthYears } from "../lib/estimated-dates";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, fields: Partial<Person> = {}): Person => ({ id, displayName: id, gender: null, givenName: id, familyName: null, maidenName: null, birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null, ...fields });
const parent = (from: string, to: string) => ({ id: `p-${from}-${to}`, fromPersonId: from, toPersonId: to, type: "parent" as const, status: null });
const spouse = (a: string, b: string) => ({ id: `s-${a}-${b}`, fromPersonId: a, toPersonId: b, type: "spouse" as const, status: null });

describe("estimated birth years", () => {
  const tree: FamilyTree = {
    people: [person("gm", { gender: "female" }), person("gf", { gender: "male" }), person("mother", { birthDate: "1950-03-01", gender: "female" }), person("father", { gender: "male" }), person("kid1", { birthDate: "1978" }), person("kid2"), person("stranger")],
    relationships: [parent("gm", "mother"), parent("gf", "mother"), spouse("gm", "gf"), spouse("mother", "father"), parent("mother", "kid1"), parent("father", "kid1"), parent("mother", "kid2"), parent("father", "kid2")],
    stories: [],
  };
  const estimates = estimateBirthYears(tree);
  it("places parents a generation before their dated children", () => {
    expect(estimates.get("gm")?.year).toBe(1922);
    expect(estimates.get("gm")?.reason).toBe("from her children's births");
  });
  it("places a sibling beside a dated one, and a spouse beside theirs", () => {
    expect(estimates.get("kid2")?.year).toBe(1978);
    expect(estimates.get("kid2")?.reason).toBe("from their siblings' births");
    expect(Math.abs((estimates.get("father")?.year ?? 0) - 1950)).toBeLessThanOrEqual(1);
  });
  it("never estimates a recorded date and never invents one for the unconnected", () => {
    expect(estimates.has("mother")).toBe(false);
    expect(estimates.has("stranger")).toBe(false);
  });
  it("widens the spread as a guess rests on other guesses", () => {
    expect((estimates.get("gf")?.spread ?? 0)).toBeGreaterThanOrEqual(estimates.get("gm")?.spread ?? 0);
  });
});

describe("estimates that would be impossible", () => {
  it("never places a birth after the person's own recorded death, or after today", () => {
    // a contradictory record: recorded dead in 1900, with a child recorded born 1990
    const tree: FamilyTree = {
      people: [person("ancestor", { deathDate: "1900-06-01", gender: "male" }), person("child", { birthDate: "1990" }), person("future"), person("futureChild", { birthDate: "2020" })],
      relationships: [parent("ancestor", "child"), parent("future", "futureChild")],
      stories: [],
    };
    const estimates = estimateBirthYears(tree, new Date("2026-09-06T00:00:00Z"));
    expect(estimates.has("ancestor")).toBe(false);
    // a child born 2020 would put their own child at 2048; that is not a fact
    expect(estimates.has("future")).toBe(true);
    expect(estimates.get("future")!.year).toBeLessThanOrEqual(2026);
  });
});
