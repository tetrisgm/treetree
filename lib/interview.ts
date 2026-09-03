import type { FamilyTree, Person } from "./types";
import { familyGenerations, lifeStatus } from "./life-status";

/** Gaps worth asking a living relative about. The archive is filled in by
 * people who knew these families, so the questions have to stay close to who
 * the editor is talking about - a stranger eight generations back is not
 * something anyone can answer. */
export type InterviewLead = { personId: string; personName: string; missing: string[]; nearTo: string | null };

const has = (value: string | null | undefined) => Boolean(value && String(value).trim());

/** Everyone within two relationship steps of the people in view, ranked by how
 * much the record is missing. */
export function interviewLeads(tree: FamilyTree, focusIds: string[], limit = 6): InterviewLead[] {
  const byId = new Map(tree.people.map((person) => [person.id, person]));
  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  for (const relationship of tree.relationships) {
    link(relationship.fromPersonId, relationship.toPersonId);
    link(relationship.toPersonId, relationship.fromPersonId);
  }

  const seeds = focusIds.filter((id) => byId.has(id));
  const near = new Map<string, string>(); // candidate id -> the focus person they hang off
  for (const seed of seeds) {
    for (const first of neighbours.get(seed) ?? []) {
      if (!near.has(first)) near.set(first, seed);
      for (const second of neighbours.get(first) ?? []) if (!near.has(second)) near.set(second, seed);
    }
  }
  const candidates = near.size ? [...near.keys()] : tree.people.map((person) => person.id);

  const generations = familyGenerations(tree);
  const gapsOf = (person: Person) => {
    const missing: string[] = [];
    if (!has(person.birthDate)) missing.push("birth year");
    if (!has(person.birthCity) && !has(person.birthPlace)) missing.push("where they were born");
    if (!has(person.gender)) missing.push("whether they are a man or a woman");
    const status = lifeStatus(person, generations);
    if (status === "died" && !has(person.deathCity)) missing.push("where they died");
    if (status === "died" && !has(person.burialPlace)) missing.push("where they are buried");
    // only of the living, and only where the archive has reason to think so:
    // asking where a great-great-grandfather lives is not a question
    if (status === "living" && !has(person.residence)) missing.push("where they live now");
    if (status === "unknown") missing.push("whether they are still living");
    if (!has(person.biography)) missing.push("anything about their life");
    return missing;
  };

  return candidates
    .map((id) => byId.get(id))
    .filter((person): person is Person => Boolean(person) && !seeds.includes(person!.id))
    .map((person) => ({ personId: person.id, personName: person.displayName, missing: gapsOf(person), nearTo: byId.get(near.get(person.id) ?? "")?.displayName ?? null }))
    .filter((lead) => lead.missing.length)
    .sort((a, b) => b.missing.length - a.missing.length || a.personName.localeCompare(b.personName))
    .slice(0, limit);
}
