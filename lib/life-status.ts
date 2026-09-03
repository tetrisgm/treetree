import type { FamilyTree, Person } from "./types";
import { buildGenerations } from "./tree-layout";

/** Whether the archive can say a person is alive.
 *
 * The old rule read "no death date and no birth date" as "could still be
 * alive", which is backwards for a genealogy: most of its records are
 * ancestors, and only 5% of this one carries a birth year. It left the
 * archive claiming that 401 of 412 people were living, Haj Chorok among
 * them, who was born in 1720.
 *
 * There are three answers, not two, and the third is the honest one. A record
 * with no death date is not evidence of life; it is an absence. So:
 *
 *   "died"    the archive records a death - a date, a place, a burial
 *   "living"  there is positive reason to think so: a birth inside a
 *             lifetime, or a place in the last generations of the tree
 *   "unknown" no death recorded and no reason to think they are alive
 *
 * Only "living" is asked where they live, invited to an interview, or
 * counted as missing a residence. "unknown" is left alone, which is what an
 * archive should do with a question it cannot answer.
 */

export type LifeStatus = "died" | "living" | "unknown";

/** A lifetime, generously drawn. Someone born within it may be alive. */
const LIFETIME_YEARS = 100;

const yearOf = (value: string | null | undefined): number | null => {
  const parsed = Number(String(value ?? "").slice(0, 4));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const hasRecordedDeath = (person: Person): boolean =>
  Boolean(person.deathDate || person.deathCity || person.deathCountry || person.burialPlace);

/** Which generations of this family still hold living people, worked out from
 * the archive's own dates rather than from a fixed number of generations back.
 *
 * Counting generations from the youngest gets the line wrong: this tree is
 * nine deep, and where the living begin depends on the family, not on the
 * depth. But a generation's recorded births place it in time even when most
 * of its people carry no dates - the latest birth recorded anywhere in
 * the reference archive's youngest-elder generation is 1952, and in the one above it, 1893. So a
 * generation whose latest recorded birth falls inside a lifetime is a living
 * generation, and so is every generation below it.
 *
 * Worth computing once and passing in: it walks the whole tree. */
export type Generations = { depth: Map<string, number>; deepest: number; livingFrom: number | null };

export function familyGenerations(tree: FamilyTree, today = new Date()): Generations {
  const depth = buildGenerations(tree).depth;
  let deepest = 0;
  const latestBirth = new Map<number, number>();
  for (const person of tree.people) {
    const level = depth.get(person.id);
    if (level === undefined) continue;
    if (level > deepest) deepest = level;
    const born = yearOf(person.birthDate);
    if (born !== null) latestBirth.set(level, Math.max(latestBirth.get(level) ?? 0, born));
  }
  // the shallowest generation still inside a lifetime; everything below it is
  // younger again, so it inherits the same answer
  let livingFrom: number | null = null;
  for (const [level, born] of latestBirth) {
    if (today.getFullYear() - born > LIFETIME_YEARS) continue;
    if (livingFrom === null || level < livingFrom) livingFrom = level;
  }
  // The generation above is the parents of living people, and is usually
  // living too - but only where the archive has nothing to say about it. A
  // generation with dated births is placed by them: the one above it
  // has births in 1893, and no parent of the living was born then.
  if (livingFrom !== null && livingFrom > 0 && !latestBirth.has(livingFrom - 1)) livingFrom -= 1;
  return { depth, deepest, livingFrom };
}

export function lifeStatus(person: Person, generations: Generations | null, today = new Date()): LifeStatus {
  if (hasRecordedDeath(person)) return "died";
  const born = yearOf(person.birthDate);
  if (born !== null) return today.getFullYear() - born <= LIFETIME_YEARS ? "living" : "unknown";
  // No dates at all. Where they stand in the tree is the only evidence there
  // is, and the last generations are the ones with people in them.
  if (!generations || generations.livingFrom === null) return "unknown";
  const level = generations.depth.get(person.id);
  if (level === undefined) return "unknown";
  return level >= generations.livingFrom ? "living" : "unknown";
}

/** For the places that only care whether to ask a living person's questions. */
export const isLiving = (person: Person, generations: Generations | null, today = new Date()): boolean =>
  lifeStatus(person, generations, today) === "living";
