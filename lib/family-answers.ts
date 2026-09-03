/** The questions families actually ask, answered from the records.
 *
 * Incumbent genealogy APIs are record-management surfaces - persons,
 * relationships, sources - but the questions people bring to a family tree
 * are relational and narrative: "how am I related to her?", "what was his
 * life like?", "where do we come from?", "who am I named after?", "whose
 * birthday is coming?". This module is the intent layer between the graph
 * and every agent surface (hosted MCP, WebMCP, the archivist): pure
 * functions over the tree, ego-aware where the asker is known, always
 * derived from the records and never guessed.
 */

import type { FamilyTree, Person } from "./types";
import { describeRelationship, relationshipSentence } from "./relationship-path";
import { buildGenerations } from "./tree-layout";
import { peopleMentionedInArchiveText } from "./archive-query-context";

const year = (date: string | null | undefined): number | null => {
  const value = Number(date?.slice(0, 4));
  return Number.isFinite(value) && value > 0 ? value : null;
};

const lifespan = (person: Person) => {
  const born = year(person.birthDate);
  const died = year(person.deathDate);
  return born || died ? ` (${born ?? "?"}–${died ?? ""})` : "";
};

export const briefName = (person: Person) => `${person.displayName}${lifespan(person)}`;

function relativesOf(tree: FamilyTree, id: string) {
  const parents: Person[] = [], children: Person[] = [], spouses: Person[] = [];
  for (const link of tree.relationships) {
    if (link.type === "parent" && link.toPersonId === id) { const p = tree.people.find((c) => c.id === link.fromPersonId); if (p) parents.push(p); }
    if (link.type === "parent" && link.fromPersonId === id) { const c = tree.people.find((c) => c.id === link.toPersonId); if (c) children.push(c); }
    if (link.type === "spouse" && (link.fromPersonId === id || link.toPersonId === id)) {
      const other = tree.people.find((c) => c.id === (link.fromPersonId === id ? link.toPersonId : link.fromPersonId));
      if (other) spouses.push(other);
    }
  }
  children.sort((a, b) => (year(a.birthDate) ?? 9999) - (year(b.birthDate) ?? 9999));
  return { parents, children, spouses };
}

/** "How am I related to …?" - the most-asked question at any family
 * gathering, answered in kinship words from the asker's point of view. */
export function kinshipToEgo(tree: FamilyTree, egoId: string | null, otherId: string): string {
  if (!egoId) return "The archive does not know which person in the tree you are yet, so it cannot answer from your point of view. Say who you are in the tree first, or ask about two named people instead.";
  if (egoId === otherId) return "That is you.";
  const result = describeRelationship(tree, egoId, otherId);
  if (!result) {
    const other = tree.people.find((person) => person.id === otherId);
    return `No recorded chain of relationships connects you and ${other?.displayName ?? "that person"}.`;
  }
  return relationshipSentence(result).replace(`${result.from.displayName}'s`, "your");
}

/** A life told in order, not a field dump. */
export function lifeStory(tree: FamilyTree, personId: string): string {
  const person = tree.people.find((candidate) => candidate.id === personId);
  if (!person) throw new Error("That person is not in the tree.");
  const { parents, children, spouses } = relativesOf(tree, person.id);
  const stories = tree.stories.filter((story) => story.personIds.includes(person.id));
  const born = year(person.birthDate);
  const died = year(person.deathDate);
  const lines: string[] = [];
  const birthPlace = person.birthCity ?? person.birthPlace;
  lines.push(`${person.displayName}${born ? ` was born in ${born}` : ""}${birthPlace ? `${born ? "" : " was born"} in ${[birthPlace, person.birthCountry].filter(Boolean).join(", ")}` : ""}${parents.length ? `, ${born || birthPlace ? "to" : "the child of"} ${parents.map((p) => p.displayName).join(" and ")}` : ""}.`.replace(" .", "."));
  if (spouses.length) lines.push(`${person.gender === "female" ? "She" : person.gender === "male" ? "He" : "They"} married ${spouses.map((s) => s.displayName).join(", and later ")}.`);
  if (children.length) lines.push(`${children.length === 1 ? "One child is recorded" : `${children.length} children are recorded`}: ${children.map(briefName).join("; ")}.`);
  if (person.residence) lines.push(`Last recorded living in ${person.residence}.`);
  if (person.biography) lines.push(person.biography);
  if (stories.length) lines.push(`The archive keeps ${stories.length === 1 ? "a story" : `${stories.length} stories`} involving ${person.displayName}: ${stories.map((story) => `“${story.title}”`).join(", ")}.`);
  if (died) {
    const deathPlace = person.deathCity ?? person.deathPlace;
    lines.push(`${person.displayName} died in ${died}${deathPlace ? ` in ${[deathPlace, person.deathCountry].filter(Boolean).join(", ")}` : ""}${born ? `, aged about ${died - born}` : ""}.`);
  }
  return lines.join("\n");
}

/** "Where does our family come from?" - places by generation, oldest first,
 * so migrations read as movement rather than a frequency table. */
export function familyOrigins(tree: FamilyTree): string {
  const { depth } = buildGenerations(tree);
  const byGeneration = new Map<number, Map<string, number>>();
  for (const person of tree.people) {
    const place = [person.birthCity ?? person.birthPlace, person.birthCountry].filter(Boolean).join(", ");
    if (!place) continue;
    const generation = depth.get(person.id) ?? 0;
    const places = byGeneration.get(generation) ?? new Map<string, number>();
    places.set(place, (places.get(place) ?? 0) + 1);
    byGeneration.set(generation, places);
  }
  if (!byGeneration.size) return "No birth places are recorded yet, so the archive cannot say where the family comes from.";
  const lines = [...byGeneration.entries()].sort((a, b) => a[0] - b[0]).map(([generation, places]) => {
    const top = [...places.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return `- Generation ${generation + 1}: ${top.map(([place, count]) => `${place} (${count})`).join(", ")}`;
  });
  return `Recorded birth places, oldest generation first - read downward to see the family move:\n${lines.join("\n")}`;
}

/** "What was the family like in 1950?" */
export function familyInYear(tree: FamilyTree, when: number): string {
  const born = tree.people.filter((person) => year(person.birthDate) === when);
  const died = tree.people.filter((person) => year(person.deathDate) === when);
  const alive = tree.people.filter((person) => {
    const birth = year(person.birthDate);
    const death = year(person.deathDate);
    return birth !== null && birth <= when && (death === null || death >= when);
  });
  const eldest = alive.length ? alive.reduce((a, b) => (year(a.birthDate)! < year(b.birthDate)! ? a : b)) : null;
  const lines = [
    born.length ? `Born in ${when}: ${born.map((p) => p.displayName).join(", ")}.` : "",
    died.length ? `Died in ${when}: ${died.map(briefName).join(", ")}.` : "",
    alive.length ? `${alive.length} people with recorded birth years were alive${eldest ? `; the eldest was ${eldest.displayName}, about ${when - year(eldest.birthDate)!}` : ""}.` : `No one with a recorded birth year was alive in ${when}.`,
    "Only people with recorded years are counted - most of this archive's records carry no dates, so the real family was larger.",
  ].filter(Boolean);
  return lines.join("\n");
}

/** "Who am I named after?" - recurring given names across generations. */
export function namesakes(tree: FamilyTree, givenName: string): string {
  const needle = givenName.trim().toLowerCase();
  if (!needle) throw new Error("Give a name to look for.");
  const { depth } = buildGenerations(tree);
  const matches = tree.people
    .filter((person) => (person.givenName ?? person.displayName.split(" ")[0]).toLowerCase() === needle
      || person.displayName.toLowerCase().startsWith(`${needle} `))
    .sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0));
  if (!matches.length) return `Nobody in the tree carries the name ${givenName}.`;
  if (matches.length === 1) return `${briefName(matches[0])} is the only recorded ${givenName}.`;
  return `${matches.length} people carry the name across the generations, eldest line first:\n${matches.map((person) => `- ${briefName(person)} (generation ${(depth.get(person.id) ?? 0) + 1})`).join("\n")}\nNames handed down like this usually honour the earlier bearer.`;
}

/** Birthdays of the living and remembrance days in the next month - full
 * dates only, since a bare year has no day to fall on. */
export function upcomingDates(tree: FamilyTree, today = new Date()): string {
  const horizon = 31;
  const inWindow = (date: string | null | undefined): number | null => {
    if (!date || date.length < 10) return null;
    const [, month, day] = date.split("-").map(Number);
    if (!month || !day) return null;
    const next = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
    if (next.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) next.setUTCFullYear(next.getUTCFullYear() + 1);
    const days = Math.round((next.getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000);
    return days <= horizon ? days : null;
  };
  const entries: { days: number; text: string }[] = [];
  for (const person of tree.people) {
    const birthday = inWindow(person.birthDate);
    if (birthday !== null && !person.deathDate) entries.push({ days: birthday, text: `${person.displayName}'s birthday${birthday === 0 ? " is today" : ` in ${birthday} day${birthday === 1 ? "" : "s"}`}` });
    const memorial = inWindow(person.deathDate);
    if (memorial !== null) entries.push({ days: memorial, text: `the anniversary of ${person.displayName}'s death${memorial === 0 ? " is today" : ` in ${memorial} day${memorial === 1 ? "" : "s"}`}` });
  }
  if (!entries.length) return "No full-dated birthdays or anniversaries fall in the next month.";
  return `In the next month: ${entries.sort((a, b) => a.days - b.days).map((entry) => entry.text).join("; ")}.`;
}

/** Precomputed intent answers for the archivist's prompt.
 *
 * The archivist's house rule is that graph facts are computed, never
 * model-derived: the ask and editor-chat routes already inject pairwise
 * relationships. This adds the intent layer's answers - who the asker is and
 * their kinship to everyone the question mentions, a snapshot of any year
 * named (Persian and Arabic-Indic digits included), where the family comes
 * from, and the month's dates - so "how am I related to her?" or "what was
 * the family like in ۱۹۵۰?" is answered from the records in any language. */
export function intentContext(tree: FamilyTree, message: string, egoId: string | null): string {
  const blocks: string[] = [];

  const ego = egoId ? tree.people.find((person) => person.id === egoId) : undefined;
  if (ego) {
    const kin = peopleMentionedInArchiveText(tree, message)
      .filter((person) => person.id !== ego.id)
      .map((person) => {
        const result = describeRelationship(tree, ego.id, person.id);
        return result
          ? relationshipSentence(result).replace(`${ego.displayName}'s`, "the asker's")
          : `No recorded chain connects the asker and ${person.displayName}.`;
      });
    blocks.push([`The person asking is ${briefName(ego)} in the tree; "I", "me", and "my" mean them.`, ...kin].join("\n"));
  }

  // years written in Latin, Persian, or Arabic-Indic digits
  const western = message.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  const years = [...new Set(western.match(/\b1[0-9]{3}\b|\b20[0-9]{2}\b/g) ?? [])].slice(0, 2);
  for (const mentioned of years) blocks.push(`The family in ${mentioned} (computed):\n${familyInYear(tree, Number(mentioned))}`);

  blocks.push(`Family origins (computed):\n${familyOrigins(tree)}`);
  blocks.push(`Dates this month (computed):\n${upcomingDates(tree)}`);
  return blocks.join("\n\n");
}
