import type { FamilyTree, Person } from "./types";
import { familyGenerations, lifeStatus, type Generations } from "./life-status";

/** Something the archive can say without being asked: an anniversary falling
 * today, or a fact drawn from the shape of the tree. Used to greet a reader
 * before their first question, and by the archivist when asked for one. */
export type FamilyFact = {
  kind: "onThisDay" | "factoid";
  text: string;
  personId?: string;
  /** what to ask the archivist when a reader taps the fact, so a number is a
   *  way into the family rather than a dead end */
  ask?: string;
};

const year = (value: string | null | undefined) => {
  const parsed = Number(String(value ?? "").slice(0, 4));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const monthDay = (value: string | null | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value).slice(5) : null;
/* Whether to wish someone a happy birthday. The archive used to say yes for
 * anyone without a death date, which included every ancestor it holds. */
const presumedLiving = (person: Person, today: Date, generations: Generations | null = null) =>
  lifeStatus(person, generations, today) === "living";

/** Anniversaries falling on the given day: births and deaths of the recorded
 * family, and dated stories. Living people get a birthday; the dead get a
 * remembrance. */
export function onThisDay(tree: FamilyTree, today = new Date()): FamilyFact[] {
  const stamp = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const facts: FamilyFact[] = [];
  // Working out generations walks the complete relationship graph. Most days
  // have no recorded birthday, and death/story anniversaries do not need that
  // work at all, so defer it until a matching birth actually needs a life
  // status. Several birthdays on the same day still share one computation.
  let generations: Generations | undefined;
  for (const person of tree.people) {
    if (monthDay(person.birthDate) === stamp) {
      const born = year(person.birthDate);
      const age = born ? today.getFullYear() - born : null;
      generations ??= familyGenerations(tree, today);
      facts.push({
        kind: "onThisDay", personId: person.id,
        text: presumedLiving(person, today, generations) && age
          ? `Today is ${person.displayName}'s birthday — they turn ${age}.`
          : age
            ? `${person.displayName} was born on this day in ${born}, ${age} years ago today.`
            : `${person.displayName} was born on this day.`,
      });
    }
    if (monthDay(person.deathDate) === stamp) {
      const died = year(person.deathDate);
      facts.push({
        kind: "onThisDay", personId: person.id,
        text: died ? `${person.displayName} died on this day in ${died}.` : `${person.displayName} died on this day.`,
      });
    }
  }
  for (const story of tree.stories) {
    if (monthDay(story.date) !== stamp) continue;
    facts.push({ kind: "onThisDay", text: `On this day in ${year(story.date)}: “${story.title}”.` });
  }
  return facts;
}

/** Facts about the shape of the family - true of the records as they stand,
 * recomputed every time so they never go stale. */
export function familyFactoids(tree: FamilyTree, today = new Date()): FamilyFact[] {
  const facts: FamilyFact[] = [];
  const withYears = tree.people.filter((person) => year(person.birthDate) && year(person.deathDate));
  const childrenOf = new Map<string, number>();
  for (const link of tree.relationships) {
    if (link.type !== "parent") continue;
    childrenOf.set(link.fromPersonId, (childrenOf.get(link.fromPersonId) ?? 0) + 1);
  }

  // What the numbers themselves say. Each is one pass over the people, cheap
  // enough for a per-request greeting on the Worker's budget.
  const spans = withYears.map((person) => year(person.deathDate)! - year(person.birthDate)!).filter((age) => age >= 0).sort((a, b) => a - b);
  if (spans.length >= 8) {
    const median = spans.length % 2 ? spans[(spans.length - 1) / 2] : Math.round((spans[spans.length / 2 - 1] + spans[spans.length / 2]) / 2);
    facts.push({ kind: "factoid", text: `Half of the ${spans.length} completed lives in the archive reached ${median} years or more.`, ask: `Which lives in the family were the longest, and which ended early?` });
  }

  const decades = new Map<string, number>();
  const surnames = new Map<string, number>();
  const given = new Map<string, number>();
  for (const person of tree.people) {
    const born = year(person.birthDate);
    if (born) decades.set(`${Math.floor(born / 10) * 10}s`, (decades.get(`${Math.floor(born / 10) * 10}s`) ?? 0) + 1);
    const parts = person.displayName.split(/\s+/).filter((token) => !/^\(.*\)$/.test(token));
    if (parts.length > 1) { const name = parts.slice(1).join(" "); surnames.set(name, (surnames.get(name) ?? 0) + 1); }
    if (parts.length) given.set(parts[0], (given.get(parts[0]) ?? 0) + 1);
  }
  // Most of the 412 records carry no birth year, so this is a fact about the
  // dates the archive holds, not about the family - and it is only worth
  // saying when the leading decade is clearly ahead of the next one.
  const byDecade = [...decades.entries()].sort((a, b) => b[1] - a[1]);
  const datedBirths = [...decades.values()].reduce((sum, count) => sum + count, 0);
  if (byDecade[0] && byDecade[0][1] >= 5 && byDecade[0][1] >= (byDecade[1]?.[1] ?? 0) + 2) {
    facts.push({ kind: "factoid", text: `Of the ${datedBirths} birth years the archive records, more fall in the ${byDecade[0][0]} than in any other decade — ${byDecade[0][1]} of them.`, ask: `Who was born in the ${byDecade[0][0]}, and what was happening to the family then?` });
  }

  // Two names side by side are two families unless one spells the other -
  // Golestani and Golestani are one name, Golestani and Jaberian are two.
  const twoNames = [...surnames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (twoNames.length === 2 && twoNames[1][1] > 2) {
    const [first, second] = twoNames;
    const variant = first[0].startsWith(second[0]) || second[0].startsWith(first[0]);
    facts.push(variant
      ? { kind: "factoid", text: `The family name is written two ways: ${first[1]} people carry ${first[0]} and ${second[1]} carry ${second[0]}.`, ask: `Why does the family name appear as both ${first[0]} and ${second[0]}?` }
      : { kind: "factoid", text: `Two family names run through the archive: ${first[0]}, carried by ${first[1]} people, and ${second[0]}, carried by ${second[1]}.`, ask: `How did the ${first[0]} and ${second[0]} families come together?` });
  }
  const repeated = [...given.entries()].sort((a, b) => b[1] - a[1])[0];
  if (repeated && repeated[1] > 2) facts.push({ kind: "factoid", text: `${repeated[0]} is the most repeated given name in the family — ${repeated[1]} people carry it.`, ask: `Who are the people named ${repeated[0]}, and were they named after one another?` });

  const women = tree.people.filter((person) => person.gender === "female").length;
  const men = tree.people.filter((person) => person.gender === "male").length;
  if (women > 5 && men > 5) facts.push({ kind: "factoid", text: `${women} women and ${men} men are recorded in the archive.`, ask: "Tell me about the women in the family — what does the archive record about them?" });

  const longest = withYears.map((person) => ({ person, age: year(person.deathDate)! - year(person.birthDate)! }))
    .sort((a, b) => b.age - a.age)[0];
  if (longest) facts.push({ kind: "factoid", personId: longest.person.id, text: `${longest.person.displayName} lived the longest life the archive records — ${longest.age} years, from ${year(longest.person.birthDate)} to ${year(longest.person.deathDate)}.`, ask: `Tell me about ${longest.person.displayName} and the years they lived through.` });

  const mostChildren = [...childrenOf.entries()].sort((a, b) => b[1] - a[1])[0];
  const parent = mostChildren && tree.people.find((person) => person.id === mostChildren[0]);
  if (parent && mostChildren[1] > 1) facts.push({ kind: "factoid", personId: parent.id, text: `${parent.displayName} has the most recorded children in the family: ${mostChildren[1]}.`, ask: `Who are ${parent.displayName}'s children, and what became of them?` });

  const oldest = tree.people.filter((person) => year(person.birthDate)).sort((a, b) => year(a.birthDate)! - year(b.birthDate)!)[0];
  if (oldest) facts.push({ kind: "factoid", personId: oldest.id, text: `The earliest recorded birth in the family is ${oldest.displayName}, in ${year(oldest.birthDate)} — ${today.getFullYear() - year(oldest.birthDate)!} years ago.`, ask: `Tell me about ${oldest.displayName}, the earliest person the archive records.` });

  const places = new Map<string, number>();
  for (const person of tree.people) {
    for (const city of [person.birthCity, person.deathCity]) {
      if (city) places.set(city, (places.get(city) ?? 0) + 1);
    }
  }
  const topPlace = [...places.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topPlace) facts.push({ kind: "factoid", text: `${topPlace[0]} appears in more records than anywhere else — ${topPlace[1]} births and deaths.`, ask: `What is the family's connection to ${topPlace[0]}?` });

  if (tree.stories.length) {
    // only claim bilingual keeping when stories actually carry an original
    const bilingual = tree.stories.some((story) => story.originalBody);
    facts.push({ kind: "factoid", text: `The archive holds ${tree.stories.length} family ${tree.stories.length === 1 ? "story" : "stories"}${bilingual ? ", kept in the language they were written in with an English translation beside them" : ""}.`, ask: "What stories does the archive hold, and who is in them?" });
  }

  const generations = new Set(tree.people.map((person) => year(person.birthDate)).filter(Boolean).map((born) => Math.floor((born! - 1700) / 25)));
  if (generations.size > 3) facts.push({ kind: "factoid", text: `${tree.people.length} people are recorded here, spanning roughly ${generations.size} generations.`, ask: "Walk me down the generations, from the earliest ancestor to the youngest child." });


  return facts;
}

/** One line to greet a reader with: an anniversary if the day has one,
 * otherwise a factoid chosen by the date so it is steady through the day and
 * different tomorrow. */
export function greetingFact(tree: FamilyTree, today = new Date()): FamilyFact | null {
  const anniversaries = onThisDay(tree, today);
  if (anniversaries.length) {
    const index = (today.getFullYear() + today.getMonth() + today.getDate()) % anniversaries.length;
    return anniversaries[index];
  }
  const factoids = familyFactoids(tree, today);
  if (!factoids.length) return null;
  const dayNumber = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86_400_000);
  return factoids[dayNumber % factoids.length];
}
