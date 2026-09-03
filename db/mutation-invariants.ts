import type { FamilyTree, Relationship } from "../lib/types";

type RelationshipType = Relationship["type"];

/**
 * Preflights mutations against the current tree. The in-memory state advances
 * after each accepted addition so one batch cannot become invalid only when
 * its statements are considered together.
 */
export class MutationInvariants {
  private readonly people: Set<string>;
  private readonly peopleByName = new Map<string, string[]>();
  private readonly stories: Set<string>;
  private readonly attachments: Set<string>;
  private readonly relationships: Relationship[];

  constructor(
    tree: Pick<FamilyTree, "people" | "relationships" | "stories">,
    attachmentIds: Iterable<string> = [],
  ) {
    this.people = new Set(tree.people.map(({ id }) => id));
    for (const person of tree.people) {
      const name = person.displayName.trim().toLowerCase();
      this.peopleByName.set(name, [...(this.peopleByName.get(name) ?? []), person.id]);
    }
    this.stories = new Set(tree.stories.map(({ id }) => id));
    this.attachments = new Set(attachmentIds);
    this.relationships = [...tree.relationships];
  }

  addPerson(personId: string) {
    this.people.add(personId);
  }

  person(personId: string) {
    if (!this.people.has(personId)) throw new Error("That person is no longer in the tree.");
  }

  personIdByUniqueName(displayName: string) {
    const matches = this.peopleByName.get(displayName.trim().toLowerCase()) ?? [];
    if (matches.length > 1) throw new Error(`More than one person is named ${displayName.trim()}.`);
    return matches[0] ?? null;
  }

  addRelationship(fromPersonId: string, toPersonId: string, type: RelationshipType) {
    if (!this.people.has(fromPersonId) || !this.people.has(toPersonId)) {
      throw new Error("A referenced person no longer exists.");
    }
    if (fromPersonId === toPersonId) throw new Error("A person cannot be related to themself.");

    const duplicate = this.relationships.some((relationship) =>
      relationship.type === type
      && relationship.fromPersonId === fromPersonId
      && relationship.toPersonId === toPersonId);
    if (duplicate) throw new Error("That relationship already exists.");

    if (type === "spouse") {
      const reverse = this.relationships.some((relationship) =>
        relationship.type === "spouse"
        && relationship.fromPersonId === toPersonId
        && relationship.toPersonId === fromPersonId);
      if (reverse) throw new Error("That spouse relationship already exists.");
    } else {
      const parentCount = new Set(this.relationships
        .filter((relationship) => relationship.type === "parent" && relationship.toPersonId === toPersonId)
        .map((relationship) => relationship.fromPersonId)).size;
      if (parentCount >= 2) throw new Error("A person cannot have more than two recorded parents.");
      if (this.hasParentPath(toPersonId, fromPersonId)) {
        throw new Error("That parent relationship would create a cycle.");
      }
    }

    this.relationships.push({ id: "", fromPersonId, toPersonId, type });
  }

  relationship(relationshipId: string, type?: RelationshipType) {
    const relationship = this.relationships.find((candidate) =>
      candidate.id === relationshipId && (!type || candidate.type === type));
    if (!relationship) throw new Error(type === "spouse" ? "That marriage no longer exists." : "That relationship no longer exists.");
    return relationship;
  }

  story(storyId: string) {
    if (!this.stories.has(storyId)) throw new Error("That story no longer exists.");
  }

  storyPeople(personIds: readonly string[]) {
    if (personIds.some((personId) => !this.people.has(personId))) {
      throw new Error("A person linked to that story no longer exists.");
    }
  }

  storyAttachments(attachmentIds: readonly string[]) {
    if (attachmentIds.some((attachmentId) => !this.attachments.has(attachmentId))) {
      throw new Error("An attachment linked to that story no longer exists.");
    }
  }

  private hasParentPath(fromPersonId: string, toPersonId: string) {
    const children = new Map<string, string[]>();
    for (const relationship of this.relationships) {
      if (relationship.type !== "parent") continue;
      children.set(relationship.fromPersonId, [...(children.get(relationship.fromPersonId) ?? []), relationship.toPersonId]);
    }
    const pending = [fromPersonId];
    const visited = new Set<string>();
    while (pending.length) {
      const personId = pending.pop()!;
      if (personId === toPersonId) return true;
      if (visited.has(personId)) continue;
      visited.add(personId);
      pending.push(...(children.get(personId) ?? []));
    }
    return false;
  }
}
