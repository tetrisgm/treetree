import { describe, expect, it } from "vitest";
import { runRecordChecks } from "../lib/record-checks";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName: string, extra: Partial<Person> = {}): Person => ({
  id, displayName, gender: null, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null,
  birthCity: null, birthCountry: null, deathCity: null, deathCountry: null,
  burialPlace: null, residence: null, biography: null, photoAttachmentId: null, ...extra,
});
const tree = (people: Person[], relationships: FamilyTree["relationships"] = [], stories: FamilyTree["stories"] = []): FamilyTree => ({ people, relationships, stories });
const parent = (from: string, to: string) => ({ id: `${from}-${to}`, fromPersonId: from, toPersonId: to, type: "parent" as const, status: null });

describe("record checks", () => {
  it("says nothing about records that agree", () => {
    const clean = tree(
      [person("a", "Parent", { birthDate: "1900", deathDate: "1970" }), person("b", "Child", { birthDate: "1930" })],
      [parent("a", "b")],
    );
    expect(runRecordChecks(clean)).toHaveLength(0);
  });

  it("catches a death before a birth and an impossible lifespan", () => {
    const checks = runRecordChecks(tree([
      person("a", "Backwards", { birthDate: "1950", deathDate: "1940" }),
      person("b", "Ancient", { birthDate: "1800", deathDate: "1950" }),
    ]));
    expect(checks.map((check) => check.kind)).toEqual(["impossible", "impossible"]);
  });

  it("catches a child born before, too soon after, or long after a parent", () => {
    const checks = runRecordChecks(tree(
      [
        person("p", "Parent", { birthDate: "1900", deathDate: "1950", gender: "female" }),
        person("early", "Older", { birthDate: "1890" }),
        person("soon", "TooSoon", { birthDate: "1908" }),
        person("late", "Posthumous", { birthDate: "1955" }),
      ],
      [parent("p", "early"), parent("p", "soon"), parent("p", "late")],
    ));
    expect(checks).toHaveLength(3);
    expect(checks.every((check) => check.kind === "impossible")).toBe(true);
  });

  it("credits a story's claim to its subject only", () => {
    const checks = runRecordChecks(tree(
      [person("m", "Mohammad Zehtab Golestani", { birthDate: "1856", deathDate: "1939" }), person("h", "Hossein Zehtab Golestani", { birthDate: "1882", deathDate: "1937" })],
      [],
      [{ id: "s", title: "Mohammad Zehtab (Golestani), fourth generation", body: "He was over a hundred years old. Hossein ran the company.", date: null, place: null, personIds: ["m", "h"] }],
    ));
    expect(checks).toHaveLength(1);
    expect(checks[0].personIds).toEqual(["m"]);
    expect(checks[0].kind).toBe("conflict");
  });

  it("asks about same-name records only when the archive cannot tell them apart", () => {
    const ambiguous = runRecordChecks(tree(
      [person("a", "Abbas Golestani"), person("b", "Abbas Golestani"), person("p", "A Parent")],
      [parent("p", "a")],
    ));
    expect(ambiguous.map((check) => check.kind)).toEqual(["duplicate"]);

    const distinguished = runRecordChecks(tree(
      [person("a", "Abbas Golestani"), person("b", "Abbas Golestani"), person("p1", "One"), person("p2", "Two")],
      [parent("p1", "a"), parent("p2", "b")],
    ));
    expect(distinguished).toHaveLength(0);
  });
});
