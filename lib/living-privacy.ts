import type { FamilyTree, Person } from "./types";

/** A death record always wins. Without one, only a plausible modern birth
 * year is treated as living; an undated ancestor is not silently rewritten. */
export function isLikelyLiving(person: Person, year = new Date().getUTCFullYear()): boolean {
  if (person.deathDate) return false;
  const born = Number(person.birthDate?.match(/\d{4}/)?.[0]);
  return Number.isFinite(born) && born >= year - 120;
}

export function redactLivingDetails(tree: FamilyTree): FamilyTree {
  const livingIds = new Set(tree.people.filter((person) => isLikelyLiving(person)).map((person) => person.id));
  return {
    people: tree.people.map((person) => livingIds.has(person.id) ? {
      ...person, birthDate: person.birthDate?.slice(0, 4) ?? null, birthPlace: null, birthCity: null, birthCountry: null,
      residence: null, biography: null, photoAttachmentId: null, photoIds: [],
    } : person),
    relationships: tree.relationships,
    stories: tree.stories.filter((story) => !story.personIds.some((id) => livingIds.has(id))),
    // an id number reveals nothing; losing it broke the landing view for
    // every anonymous visitor of a public archive
    rootPersonId: tree.rootPersonId ?? null,
  };
}

export function attachmentBelongsToLivingPerson(tree: FamilyTree, attachmentId: string): boolean {
  return tree.people.some((person) => isLikelyLiving(person)
    && (person.photoAttachmentId === attachmentId || person.photoIds?.includes(attachmentId)));
}
