import { describe, expect, it } from "vitest";
import { answerableGaps, questionsForMember } from "../lib/who-can-answer";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, fields: Partial<Person> = {}): Person => ({ id, displayName: id, gender: "male", givenName: id, familyName: null, maidenName: null, birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: "photo", ...fields });
const parent = (from: string, to: string) => ({ id: `p-${from}-${to}`, fromPersonId: from, toPersonId: to, type: "parent" as const, status: null });

// four generations: an ancestor nobody alive met, then a grandfather, a
// living father, and his living child
const tree: FamilyTree = {
  people: [
    person("ancestor", { displayName: "Ancestor", birthDate: "1780", deathDate: "1850" }),
    person("grandfather", { displayName: "Grandfather", birthDate: "1890", deathDate: "1960" }),
    person("father", { displayName: "Father", birthDate: "1950", birthCity: "Tehran", residence: "Paris" }),
    person("child", { displayName: "Child", birthDate: "1985", birthCity: "Paris", residence: "Paris" }),
  ],
  relationships: [parent("ancestor", "grandfather"), parent("grandfather", "father"), parent("father", "child")],
  stories: [],
};

describe("who can answer", () => {
  it("ranks a gap next to the living above one nobody alive can reach", () => {
    const gaps = answerableGaps(tree, []);
    const order = gaps.map((gap) => gap.person.id);
    expect(order.indexOf("grandfather")).toBeLessThan(order.indexOf("ancestor"));
    const grandfather = gaps.find((gap) => gap.person.id === "grandfather")!;
    expect(grandfather.missing).toContain("birth place");
    expect(grandfather.couldKnow.map((who) => who.id)).toContain("father");
    expect(grandfather.distanceToLiving).toBe(1);
  });
  it("leaves complete records alone", () => {
    expect(answerableGaps(tree, []).some((gap) => gap.person.id === "child")).toBe(false);
  });
  it("puts a seated member's own questions to them, in their words", () => {
    const questions = questionsForMember(tree, "father", 3);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0].question).toMatch(/Where was Grandfather born\?|When was Grandfather born/);
    expect(questionsForMember(tree, null)).toEqual([]);
  });
});

describe("the weekly letter asks", () => {
  it("gives a seated member their own questions and an unseated one none", async () => {
    const { digestQuestions } = await import("../lib/digest");
    expect(digestQuestions(tree, "father").length).toBeGreaterThan(0);
    expect(digestQuestions(tree, null)).toEqual([]);
  });
});
