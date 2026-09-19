import source from "../examples/rowan-family.ged?raw";
import { parseGedcom } from "./gedcom-import";
import type { FamilyTree, Person, Relationship } from "./types";

/** The downloadable fixture and the sandbox use the same real parser.
 * This adapter is only for our fixture, whose display names are unique.
 * Production imports use reconciliation and audited store mutations. */
export function sampleFamily(): FamilyTree {
  const report = parseGedcom(source);
  if (report.warnings.length) throw new Error(report.warnings.join(" "));
  const people = report.proposals.filter((proposal) => proposal.kind === "add_person")
    .map((proposal, index) => ({ ...proposal.person, id: `sample-${index + 1}` }));
  const byName = new Map(people.map((person) => [person.displayName, person.id]));
  if (byName.size !== people.length) throw new Error("The sample must use unique names.");
  const relationships = report.proposals.filter((proposal) => proposal.kind === "add_relationship")
    .map((proposal, index) => {
      const fromPersonId = byName.get(proposal.fromPersonName ?? "");
      const toPersonId = byName.get(proposal.toPersonName ?? "");
      if (!fromPersonId || !toPersonId) throw new Error("The sample has an unresolved relationship.");
      return { id: `sample-link-${index + 1}`, fromPersonId, toPersonId, type: proposal.relationshipType };
    });
  return { people, relationships, stories: [], rootPersonId: byName.get("Maya Rowan") };
}

export function startingFamily(): FamilyTree {
  const sample = sampleFamily();
  const people = sample.people.filter((person) => ["Maya Rowan", "Leo Rowan"].includes(person.displayName));
  const ids = new Set(people.map((person) => person.id));
  return { ...sample, people, relationships: sample.relationships.filter((link) => ids.has(link.fromPersonId) && ids.has(link.toPersonId)) };
}

export const sampleGedcom = source;

export function newDemoPerson(name: string, birthYear = "", gender: Person["gender"] = null): Person {
  const displayName = name.trim();
  const year = birthYear.trim();
  if (!displayName || displayName.length > 120) throw new Error("Give the person a name of 1–120 characters.");
  if (year && (!/^\d{4}$/.test(year) || Number(year) < 1 || Number(year) > new Date().getUTCFullYear())) {
    throw new Error("Use a four-digit birth year, or leave it unknown.");
  }
  return {
    id: crypto.randomUUID(), displayName, gender: gender ?? null,
    givenName: displayName.split(/\s+/)[0], familyName: displayName.split(/\s+/).slice(1).join(" ") || null,
    maidenName: null, birthDate: year || null, deathDate: null, birthPlace: null, deathPlace: null,
    birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null,
    residence: null, biography: null, photoAttachmentId: null,
  };
}

/** Keep the sandbox subject to the archive's basic graph rules too. */
export function linkDemoPeople(tree: FamilyTree, fromPersonId: string, toPersonId: string, type: Relationship["type"]): FamilyTree {
  if (fromPersonId === toPersonId) throw new Error("A person cannot be their own parent or spouse.");
  if (![fromPersonId, toPersonId].every((id) => tree.people.some((person) => person.id === id))) throw new Error("Both people must be in the sandbox.");
  const duplicate = tree.relationships.some((link) => link.type === type && (
    (link.fromPersonId === fromPersonId && link.toPersonId === toPersonId) ||
    (type === "spouse" && link.fromPersonId === toPersonId && link.toPersonId === fromPersonId)));
  if (duplicate) return tree;
  if (type === "parent") {
    const parents = tree.relationships.filter((link) => link.type === "parent" && link.toPersonId === toPersonId);
    if (parents.length >= 2) throw new Error("This person already has two recorded parents.");
    const seen = new Set<string>();
    const pending = [toPersonId];
    while (pending.length) {
      const id = pending.pop()!;
      if (id === fromPersonId) throw new Error("That link would make someone their own ancestor.");
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...tree.relationships.filter((link) => link.type === "parent" && link.fromPersonId === id).map((link) => link.toPersonId));
    }
  }
  return { ...tree, relationships: [...tree.relationships, { id: crypto.randomUUID(), fromPersonId, toPersonId, type }] };
}
