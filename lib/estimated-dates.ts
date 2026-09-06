/** Rough birth years for the undated, derived from the recorded dates of
 * the people around them. Ninety-three percent of this archive's people
 * have no birth date, yet almost all of them have dated relatives - and a
 * parent is about twenty-eight years older than a child, siblings are born
 * within a few years of one another, spouses likewise. Propagated through
 * the graph, that is enough to place nearly everyone in a decade.
 *
 * Estimates are computed on read and never written to a record. Every
 * consumer shows them marked - "c. 1930" - with the reason, so a guess can
 * never be mistaken for a fact or quoted back into the archive as one. */

import type { FamilyTree } from "./types";

export type EstimatedYear = {
  year: number;
  /** how far either way the estimate could reasonably be */
  spread: number;
  /** "from her children's births" - the relatives it rests on */
  reason: string;
};

const GENERATION = 28;
const recordedYear = (date: string | null | undefined) => {
  const match = date ? /^(\d{4})/.exec(date) : null;
  return match ? Number(match[1]) : null;
};

/** every person's birth year: the recorded one, or an estimate */
export function estimateBirthYears(tree: FamilyTree, today = new Date()): Map<string, EstimatedYear> {
  const known = new Map<string, number>();
  for (const person of tree.people) {
    const year = recordedYear(person.birthDate);
    if (year) known.set(person.id, year);
  }
  const parentsOf = new Map<string, string[]>(), childrenOf = new Map<string, string[]>(), spousesOf = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const link of tree.relationships) {
    if (link.type === "parent") { push(parentsOf, link.toPersonId, link.fromPersonId); push(childrenOf, link.fromPersonId, link.toPersonId); }
    else if (link.type === "spouse") { push(spousesOf, link.fromPersonId, link.toPersonId); push(spousesOf, link.toPersonId, link.fromPersonId); }
  }
  const siblingsOf = (id: string) => {
    const set = new Set<string>();
    for (const parent of parentsOf.get(id) ?? []) for (const child of childrenOf.get(parent) ?? []) if (child !== id) set.add(child);
    return [...set];
  };
  const names = new Map(tree.people.map((person) => [person.id, person]));
  const pronoun = (id: string) => { const gender = names.get(id)?.gender; return gender === "female" ? "her" : gender === "male" ? "his" : "their"; };

  // estimates rest on recorded years first; then, in later rounds, on other
  // estimates, each round widening the spread so a chain of guesses reads
  // as the guess it is
  const estimates = new Map<string, EstimatedYear>();
  const yearOf = (id: string): { year: number; spread: number } | null => {
    const recorded = known.get(id);
    if (recorded) return { year: recorded, spread: 0 };
    const estimate = estimates.get(id);
    return estimate ? { year: estimate.year, spread: estimate.spread } : null;
  };
  for (let round = 0; round < 8; round += 1) {
    let changed = false;
    for (const person of tree.people) {
      if (known.has(person.id) || estimates.has(person.id)) continue;
      const votes: { year: number; spread: number; reason: string }[] = [];
      const collect = (ids: string[], offset: number, spread: number, reason: string) => {
        const years = ids.map(yearOf).filter((entry): entry is { year: number; spread: number } => Boolean(entry));
        if (!years.length) return;
        const mean = years.reduce((sum, entry) => sum + entry.year, 0) / years.length;
        const inherited = Math.max(...years.map((entry) => entry.spread));
        votes.push({ year: mean + offset, spread: spread + inherited, reason });
      };
      collect(childrenOf.get(person.id) ?? [], -GENERATION, 8, `from ${pronoun(person.id)} children's births`);
      collect(parentsOf.get(person.id) ?? [], GENERATION, 8, `from ${pronoun(person.id)} parents' births`);
      collect(siblingsOf(person.id), 0, 5, `from ${pronoun(person.id)} siblings' births`);
      collect(spousesOf.get(person.id) ?? [], 0, 5, `from ${pronoun(person.id)} spouse's birth`);
      if (!votes.length) continue;
      // the tightest evidence decides; the others only nudge
      votes.sort((a, b) => a.spread - b.spread);
      const best = votes[0];
      const year = Math.round(votes.length > 1 ? (best.year * 2 + votes.slice(1).reduce((sum, vote) => sum + vote.year, 0)) / (votes.length + 1) : best.year);
      /* Contradictory records exist - a man recorded dead in 1900 with a child
         recorded born in 1990 - and an estimate that lands after its own
         subject's death, or after today, is worse than no estimate at all: it
         puts a birth below a death on the timeline and states a nonsense as a
         fact to the archivist. Say nothing rather than something impossible. */
      const ceiling = Math.min(recordedYear(person.deathDate) ?? Infinity, today.getUTCFullYear());
      if (year > ceiling) continue;
      estimates.set(person.id, { year, spread: best.spread, reason: best.reason });
      changed = true;
    }
    if (!changed) break;
  }
  return estimates;
}

/** "c. 1930" for a card or a line */
export const circa = (estimate: EstimatedYear) => `c. ${estimate.year}`;
