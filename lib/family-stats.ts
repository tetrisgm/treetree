import type { FamilyTree, Person } from "./types";
import { buildGenerations } from "./tree-layout";

export type FamilyStats = {
  people: number;
  women: number;
  men: number;
  unrecordedGender: number;
  withBirthDate: number;
  withPhoto: number;
  withBiography: number;
  stories: number;
  relationships: { parent: number; spouse: number };
  /** completed lives only - a living person's span is not a lifespan */
  lifespans: { median: number | null; longest: { name: string; years: number } | null; count: number };
  generations: { label: string; count: number }[];
  births: { decade: string; count: number }[];
  places: { label: string; count: number }[];
  surnames: { label: string; count: number }[];
  givenNames: { label: string; count: number }[];
  largestFamilies: { name: string; children: number }[];
};

const year = (value: string | null | undefined) => {
  const parsed = Number(String(value ?? "").slice(0, 4));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const top = (counts: Map<string, number>, limit: number) =>
  [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([label, count]) => ({ label, count }));
const bump = (counts: Map<string, number>, key: string | null | undefined) => {
  if (!key || !String(key).trim()) return;
  const label = String(key).trim();
  counts.set(label, (counts.get(label) ?? 0) + 1);
};
/** parenthesised alternates are archive spellings, not name parts */
const nameParts = (person: Person) => person.displayName.split(/\s+/).filter((token) => !/^\(.*\)$/.test(token));

export function buildFamilyStats(tree: FamilyTree): FamilyStats {
  const byId = new Map(tree.people.map((person) => [person.id, person]));
  const childCount = new Map<string, number>();
  let parentLinks = 0, spouseLinks = 0;
  for (const link of tree.relationships) {
    if (link.type === "parent") { parentLinks += 1; childCount.set(link.fromPersonId, (childCount.get(link.fromPersonId) ?? 0) + 1); }
    else spouseLinks += 1;
  }

  const completed = tree.people
    .map((person) => ({ person, born: year(person.birthDate), died: year(person.deathDate) }))
    .filter((entry) => entry.born && entry.died && entry.died >= entry.born)
    .map((entry) => ({ name: entry.person.displayName, years: entry.died! - entry.born! }));
  const sortedSpans = completed.map((entry) => entry.years).sort((a, b) => a - b);
  const median = sortedSpans.length
    ? sortedSpans.length % 2 ? sortedSpans[(sortedSpans.length - 1) / 2] : Math.round((sortedSpans[sortedSpans.length / 2 - 1] + sortedSpans[sortedSpans.length / 2]) / 2)
    : null;

  const depth = buildGenerations(tree).depth;
  const generationCounts = new Map<number, number>();
  for (const person of tree.people) {
    const level = depth.get(person.id);
    if (level === undefined) continue;
    generationCounts.set(level, (generationCounts.get(level) ?? 0) + 1);
  }

  const decades = new Map<string, number>();
  const places = new Map<string, number>();
  const surnames = new Map<string, number>();
  const givenNames = new Map<string, number>();
  for (const person of tree.people) {
    const born = year(person.birthDate);
    if (born) bump(decades, `${Math.floor(born / 10) * 10}s`);
    bump(places, person.birthCity);
    bump(places, person.deathCity);
    const parts = nameParts(person);
    if (parts.length > 1) bump(surnames, parts.slice(1).join(" "));
    if (parts.length) bump(givenNames, parts[0]);
  }

  return {
    people: tree.people.length,
    women: tree.people.filter((person) => person.gender === "female").length,
    men: tree.people.filter((person) => person.gender === "male").length,
    unrecordedGender: tree.people.filter((person) => !person.gender).length,
    withBirthDate: tree.people.filter((person) => person.birthDate).length,
    withPhoto: tree.people.filter((person) => person.photoAttachmentId).length,
    withBiography: tree.people.filter((person) => person.biography).length,
    stories: tree.stories.length,
    relationships: { parent: parentLinks, spouse: spouseLinks },
    lifespans: {
      median,
      longest: completed.sort((a, b) => b.years - a.years)[0] ?? null,
      count: completed.length,
    },
    generations: [...generationCounts.entries()].sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ label: `Generation ${level + 1}`, count })),
    births: [...decades.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([decade, count]) => ({ decade, count })),
    places: top(places, 8),
    surnames: top(surnames, 8),
    givenNames: top(givenNames, 8),
    largestFamilies: [...childCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, children]) => ({ name: byId.get(id)?.displayName ?? "Unknown", children })),
  };
}
