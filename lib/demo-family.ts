import source from "../examples/rowan-family.ged?raw";
import { parseGedcom } from "./gedcom-import";
import type { FamilyTree } from "./types";

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
