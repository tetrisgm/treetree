import type { FamilyTree, Person } from "./types";
export type RelationshipBuckets = Record<"parents" | "spouses" | "children" | "siblings" | "cousins", Person[]>;
export function relatedPeople(tree: FamilyTree, personId: string): RelationshipBuckets {
  const people = new Map(tree.people.map((person) => [person.id, person]));
  const parents = tree.relationships.filter((r) => r.type === "parent" && r.toPersonId === personId).map((r) => r.fromPersonId);
  const children = tree.relationships.filter((r) => r.type === "parent" && r.fromPersonId === personId).map((r) => r.toPersonId);
  const spouses = tree.relationships.filter((r) => r.type === "spouse" && (r.fromPersonId === personId || r.toPersonId === personId)).map((r) => r.fromPersonId === personId ? r.toPersonId : r.fromPersonId);
  const siblingIds = tree.relationships.filter((r) => r.type === "parent" && parents.includes(r.fromPersonId) && r.toPersonId !== personId).map((r) => r.toPersonId);
  const cousinIds = tree.relationships.filter((r) => r.type === "parent" && siblingIds.includes(r.fromPersonId)).map((r) => r.toPersonId);
  const resolve = (ids: string[]) => [...new Set(ids)].map((id) => people.get(id)).filter((person): person is Person => Boolean(person));
  return { parents: resolve(parents), spouses: resolve(spouses), children: resolve(children), siblings: resolve(siblingIds), cousins: resolve(cousinIds) };
}
