import { createRelationshipDescriber, relationshipSentence } from "./relationship-path";
import type { FamilyTree, Person } from "./types";

const words = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .match(/[\p{L}\p{N}]+/gu) ?? [];

const phrase = (value: string) => words(value).join(" ");

/** Resolve names conservatively for model context. A complete displayed name
 * wins over a shared given name, so asking about "Ali Golestani" does not also
 * pull every cousin named Ali into the prompt. A given-name-only question
 * intentionally returns every matching candidate (up to the context limit),
 * leaving the ambiguity visible rather than guessing. */
export function peopleMentionedInArchiveText(tree: FamilyTree, text: string, limit = 6): Person[] {
  const queryPhrase = ` ${phrase(text)} `;
  const queryWords = new Set(words(text));
  const candidates = tree.people.map((person) => {
    const nameWords = words(person.displayName);
    const fullName = nameWords.join(" ");
    const fullMatch = fullName.length >= 4 && queryPhrase.includes(` ${fullName} `);
    const givenNames = words(person.givenName ?? nameWords[0] ?? "");
    const givenMatch = givenNames.some((name) => name.length >= 3 && queryWords.has(name));
    return { person, fullMatch, givenMatch };
  });
  const fullMatches = candidates.filter((candidate) => candidate.fullMatch);
  return (fullMatches.length ? fullMatches : candidates.filter((candidate) => candidate.givenMatch))
    .slice(0, Math.max(0, limit))
    .map((candidate) => candidate.person);
}

export function archiveQueryRelationships(tree: FamilyTree, text: string, limit = 6) {
  const people = peopleMentionedInArchiveText(tree, text, limit);
  const relationships: string[] = [];
  if (people.length > 1) {
    const describe = createRelationshipDescriber(tree);
    for (let left = 0; left < people.length; left += 1) {
      for (let right = left + 1; right < people.length; right += 1) {
        const result = describe(people[left].id, people[right].id);
        if (result) relationships.push(relationshipSentence(result));
      }
    }
  }
  return { people, relationships };
}
