import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyTree, Person } from "../lib/types";

const life = vi.hoisted(() => ({
  familyGenerations: vi.fn(() => ({ depth: new Map<string, number>(), deepest: 0, livingFrom: null })),
  lifeStatus: vi.fn(() => "unknown" as const),
}));

vi.mock("../lib/life-status", () => ({
  familyGenerations: life.familyGenerations,
  lifeStatus: life.lifeStatus,
}));

import { onThisDay } from "../lib/family-facts";

const person = (id: string, birthDate: string | null): Person => ({
  id,
  displayName: id,
  gender: null,
  givenName: null,
  familyName: null,
  maidenName: null,
  birthDate,
  deathDate: null,
  birthPlace: null,
  deathPlace: null,
  birthCity: null,
  birthCountry: null,
  deathCity: null,
  deathCountry: null,
  burialPlace: null,
  residence: null,
  biography: null,
  photoAttachmentId: null,
});

const tree = (people: Person[], storyDate: string | null = null): FamilyTree => ({
  people,
  relationships: [],
  stories: storyDate ? [{
    id: "story",
    title: "A family story",
    body: "",
    originalBody: null,
    date: storyDate,
    place: null,
    personIds: [],
    attachmentIds: [],
  }] : [],
});

beforeEach(() => vi.clearAllMocks());

describe("family anniversaries", () => {
  it("does not walk the relationship graph for death- or story-only dates", () => {
    const facts = onThisDay(tree([], "1940-08-30"), new Date("2026-08-30T12:00:00Z"));

    expect(facts).toHaveLength(1);
    expect(life.familyGenerations).not.toHaveBeenCalled();
  });

  it("shares one generation calculation across birthdays on the same day", () => {
    const facts = onThisDay(
      tree([person("one", "1980-08-30"), person("two", "1990-08-30")]),
      new Date("2026-08-30T12:00:00Z"),
    );

    expect(facts).toHaveLength(2);
    expect(life.familyGenerations).toHaveBeenCalledOnce();
    expect(life.lifeStatus).toHaveBeenCalledTimes(2);
  });
});
