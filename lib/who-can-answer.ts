/** Which gaps in the archive someone could actually close.
 *
 * The archive knows exactly what it is missing - 398 birth dates, 408 birth
 * places - and listing them alphabetically is useless: nobody alive can say
 * where a man born in 1780 was born. What matters is who is near enough to
 * know. A gap about your own father is answerable; the same gap four
 * generations up is archaeology.
 *
 * So gaps are ranked by their distance to the living, and - when the archive
 * knows who its members are - addressed to the member closest to the person
 * in question. Pure functions over the tree; no storage of its own. */

import type { FamilyTree, Person } from "./types";
import { familyGenerations, isLiving, lifeStatus } from "./life-status";

export type Gap = {
  person: Person;
  /** the facts missing from this record, in the order worth asking */
  missing: string[];
  /** steps through recorded relationships to the nearest living person */
  distanceToLiving: number;
  /** the living relatives best placed to know, nearest first */
  couldKnow: Person[];
};

/** the facts a family record is expected to carry, in the order they matter */
export function missingFacts(person: Person, generations: ReturnType<typeof familyGenerations>): string[] {
  const missing: string[] = [];
  if (!person.birthDate) missing.push("birth date");
  if (!person.birthCity && !person.birthCountry && !person.birthPlace) missing.push("birth place");
  if (!person.gender) missing.push("gender");
  if (lifeStatus(person, generations) === "living" && !person.residence) missing.push("where they live");
  if (!person.photoAttachmentId) missing.push("photograph");
  return missing;
}

const neighbourMap = (tree: FamilyTree) => {
  const neighbours = new Map<string, string[]>();
  const link = (a: string, b: string) => neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
  for (const relationship of tree.relationships) { link(relationship.fromPersonId, relationship.toPersonId); link(relationship.toPersonId, relationship.fromPersonId); }
  return neighbours;
};

/** Every incomplete record, most answerable first.
 *
 * `seatedIds` are the people the archive's members say they are: a gap one
 * step from a member who reads the digest beats a gap one step from a living
 * relative who has never signed in. */
export function answerableGaps(tree: FamilyTree, seatedIds: string[] = [], today = new Date()): Gap[] {
  const generations = familyGenerations(tree, today);
  const neighbours = neighbourMap(tree);
  const byId = new Map(tree.people.map((person) => [person.id, person]));
  const living = tree.people.filter((person) => isLiving(person, generations, today));
  const seated = new Set(seatedIds);
  const gaps: Gap[] = [];
  for (const person of tree.people) {
    const missing = missingFacts(person, generations);
    if (!missing.length) continue;
    // breadth-first to the living: the first ring that contains anyone alive
    // is the set of people who could plausibly be asked
    const seen = new Set([person.id]);
    let frontier = [person.id];
    let distance = 0;
    let couldKnow: Person[] = [];
    while (frontier.length && distance < 6 && !couldKnow.length) {
      distance += 1;
      const next: string[] = [];
      for (const id of frontier) for (const neighbourId of neighbours.get(id) ?? []) {
        if (seen.has(neighbourId)) continue;
        seen.add(neighbourId);
        next.push(neighbourId);
        const candidate = byId.get(neighbourId);
        if (candidate && living.some((alive) => alive.id === candidate.id)) couldKnow.push(candidate);
      }
      frontier = next;
    }
    // a member who will actually read the question comes first
    couldKnow = couldKnow.sort((a, b) => Number(seated.has(b.id)) - Number(seated.has(a.id)) || a.displayName.localeCompare(b.displayName)).slice(0, 6);
    gaps.push({ person, missing, distanceToLiving: couldKnow.length ? distance : Infinity, couldKnow });
  }
  return gaps.sort((a, b) =>
    a.distanceToLiving - b.distanceToLiving
    || Number(b.couldKnow.some((person) => seated.has(person.id))) - Number(a.couldKnow.some((person) => seated.has(person.id)))
    || b.missing.length - a.missing.length
    || a.person.displayName.localeCompare(b.person.displayName));
}

/** The questions to put to one member, phrased for a person, not a database.
 * `seatId` is the person that member says they are. */
export function questionsForMember(tree: FamilyTree, seatId: string | null, limit = 3, today = new Date()): { personId: string; question: string }[] {
  if (!seatId) return [];
  const gaps = answerableGaps(tree, [seatId], today);
  const mine = gaps.filter((gap) => gap.couldKnow.some((person) => person.id === seatId));
  /* Few records sit one step from any one member, so a letter that only asks
     about those usually asks nothing. Widen to the family around them - the
     records within a few steps of their seat - until there are enough. */
  if (mine.length < limit) {
    const neighbours = neighbourMap(tree);
    const distance = new Map<string, number>([[seatId, 0]]);
    let frontier = [seatId];
    for (let step = 1; step <= 4 && frontier.length; step += 1) {
      const next: string[] = [];
      for (const id of frontier) for (const neighbourId of neighbours.get(id) ?? []) {
        if (distance.has(neighbourId)) continue;
        distance.set(neighbourId, step);
        next.push(neighbourId);
      }
      frontier = next;
    }
    for (const gap of gaps) {
      if (mine.length >= limit) break;
      if (mine.includes(gap) || !distance.has(gap.person.id)) continue;
      mine.push(gap);
    }
    mine.sort((a, b) => (distance.get(a.person.id) ?? 99) - (distance.get(b.person.id) ?? 99));
  }
  return mine.slice(0, limit).map((gap) => {
    const fact = gap.missing[0];
    const name = gap.person.displayName;
    const question = fact === "birth date" ? `When was ${name} born? Even the year helps.`
      : fact === "birth place" ? `Where was ${name} born?`
      : fact === "gender" ? `Was ${name} a man or a woman? The record does not say.`
      : fact === "where they live" ? `Where does ${name} live now?`
      : `Do you have a photograph of ${name}?`;
    return { personId: gap.person.id, question };
  });
}
