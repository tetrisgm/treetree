/** The archive's MCP tool registry - the read surface external agents get.
 *
 * One registry owns names, descriptions, schemas, and handlers (the mcp-kit
 * one-command-surface rule). Every tool reads through readTree(), the same
 * path the product uses, so visibility and quota fallbacks apply below this
 * layer and no tool can bypass them. v1 is read-only by design: write access
 * for external agents arrives as proposal tools that land in the existing
 * claims/adjudication queue (docs/PLATFORM.md phase 5), never as raw CRUD.
 */

import type { FamilyTree, Person } from "./types";
import { describeRelationship, relationshipSentence } from "./relationship-path";
import { archiveName } from "./archive-config";
import { familyInYear, familyOrigins, kinshipToEgo, lifeStory, namesakes, upcomingDates } from "./family-answers";

type JsonSchema = Record<string, unknown>;
export type McpToolContext = {
  /** the person in the tree the connected member says they are, when linked */
  egoId: string | null;
};
export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>, tree: FamilyTree, context: McpToolContext) => string;
};

const lifespan = (person: Person) => {
  const born = person.birthDate?.slice(0, 4);
  const died = person.deathDate?.slice(0, 4);
  return born || died ? ` (${born ?? "?"}–${died ?? ""})` : "";
};

const brief = (person: Person) => `${person.displayName}${lifespan(person)} [id: ${person.id}]`;

function personOrThrow(tree: FamilyTree, id: unknown): Person {
  const person = typeof id === "string" ? tree.people.find((candidate) => candidate.id === id) : undefined;
  if (!person) throw new Error(`No person with id ${String(id)}. Use find_person to look up ids by name.`);
  return person;
}

/** Resolve by id or by name - intent questions arrive with names. */
function resolvePerson(tree: FamilyTree, args: Record<string, unknown>): Person {
  if (typeof args.person_id === "string" && args.person_id) return personOrThrow(tree, args.person_id);
  const query = String(args.name ?? "").trim().toLowerCase();
  if (!query) throw new Error("Give a name or a person_id.");
  const exact = tree.people.filter((person) => person.displayName.toLowerCase() === query);
  const matches = exact.length ? exact : tree.people.filter((person) => person.displayName.toLowerCase().includes(query));
  if (!matches.length) throw new Error(`No one named "${args.name}" is recorded. Try find_person.`);
  if (matches.length > 1) throw new Error(`Several people match "${args.name}": ${matches.slice(0, 8).map(brief).join("; ")}. Use the exact name or a person_id.`);
  return matches[0];
}

function relativesOf(tree: FamilyTree, id: string) {
  const parents: Person[] = [], children: Person[] = [], spouses: Person[] = [];
  for (const link of tree.relationships) {
    if (link.type === "parent" && link.toPersonId === id) { const p = tree.people.find((c) => c.id === link.fromPersonId); if (p) parents.push(p); }
    if (link.type === "parent" && link.fromPersonId === id) { const c = tree.people.find((candidate) => candidate.id === link.toPersonId); if (c) children.push(c); }
    if (link.type === "spouse" && (link.fromPersonId === id || link.toPersonId === id)) {
      const other = tree.people.find((candidate) => candidate.id === (link.fromPersonId === id ? link.toPersonId : link.fromPersonId));
      if (other) spouses.push(other);
    }
  }
  return { parents, children, spouses };
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "tree_summary",
    description: "Overview of the family archive: how many people, relationships, and stories it holds, and where the tree begins.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, tree) => {
      const root = tree.rootPersonId ? tree.people.find((person) => person.id === tree.rootPersonId) : undefined;
      const years = tree.people.map((person) => Number(person.birthDate?.slice(0, 4))).filter((year) => Number.isFinite(year));
      return [
        `The ${archiveName()} family archive holds ${tree.people.length} people, ${tree.relationships.length} relationships, and ${tree.stories.length} stories.`,
        years.length ? `Recorded births span ${Math.min(...years)}–${Math.max(...years)}.` : "",
        root ? `The tree opens on ${brief(root)}.` : "",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "find_person",
    description: "Find people by name (case-insensitive substring). Returns matches with the ids every other tool needs.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Part of a name, in any script the archive uses." } }, required: ["query"], additionalProperties: false },
    handler: (args, tree) => {
      const query = String(args.query ?? "").trim().toLowerCase();
      if (!query) throw new Error("query must not be empty.");
      const matches = tree.people.filter((person) => person.displayName.toLowerCase().includes(query)).slice(0, 25);
      if (!matches.length) return `No person matching "${args.query}" is recorded.`;
      return matches.map((person) => `- ${brief(person)}`).join("\n");
    },
  },
  {
    name: "person_record",
    description: "A person's complete record: vital facts, parents, spouses, children, and the stories they appear in.",
    inputSchema: { type: "object", properties: { person_id: { type: "string" } }, required: ["person_id"], additionalProperties: false },
    handler: (args, tree) => {
      const person = personOrThrow(tree, args.person_id);
      const { parents, children, spouses } = relativesOf(tree, person.id);
      const stories = tree.stories.filter((story) => story.personIds.includes(person.id));
      const facts: string[] = [`# ${person.displayName}${lifespan(person)}`];
      if (person.gender) facts.push(`Gender: ${person.gender}`);
      if (person.maidenName) facts.push(`Maiden name: ${person.maidenName}`);
      if (person.birthDate || person.birthCity || person.birthCountry || person.birthPlace) facts.push(`Born: ${[person.birthDate, person.birthCity ?? person.birthPlace, person.birthCountry].filter(Boolean).join(", ")}`);
      if (person.deathDate || person.deathCity || person.deathCountry || person.deathPlace) facts.push(`Died: ${[person.deathDate, person.deathCity ?? person.deathPlace, person.deathCountry].filter(Boolean).join(", ")}`);
      if (person.residence) facts.push(`Residence: ${person.residence}`);
      if (person.biography) facts.push(`Biography: ${person.biography}`);
      if (parents.length) facts.push(`Parents: ${parents.map(brief).join("; ")}`);
      if (spouses.length) facts.push(`Spouses: ${spouses.map(brief).join("; ")}`);
      if (children.length) facts.push(`Children: ${children.map(brief).join("; ")}`);
      if (stories.length) facts.push(`Stories: ${stories.map((story) => `${story.title} [id: ${story.id}]`).join("; ")}`);
      return facts.join("\n");
    },
  },
  {
    name: "relationship_path",
    description: "How two people in the archive are related, as a sentence and the chain between them.",
    inputSchema: { type: "object", properties: { from_person_id: { type: "string" }, to_person_id: { type: "string" } }, required: ["from_person_id", "to_person_id"], additionalProperties: false },
    handler: (args, tree) => {
      const from = personOrThrow(tree, args.from_person_id);
      const to = personOrThrow(tree, args.to_person_id);
      const result = describeRelationship(tree, from.id, to.id);
      if (!result) return `The archive records no connection between ${from.displayName} and ${to.displayName}.`;
      return relationshipSentence(result);
    },
  },
  {
    name: "list_stories",
    description: "Every story the archive keeps, with the people each involves.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, tree) => {
      if (!tree.stories.length) return "The archive holds no stories yet.";
      return tree.stories.map((story) => {
        const people = story.personIds.map((id) => tree.people.find((person) => person.id === id)?.displayName).filter(Boolean);
        return `- ${story.title} [id: ${story.id}]${story.date ? ` (${story.date})` : ""}${people.length ? ` — ${people.join(", ")}` : ""}`;
      }).join("\n");
    },
  },
  {
    name: "story",
    description: "One story in full, in English and, when kept, its original language.",
    inputSchema: { type: "object", properties: { story_id: { type: "string" } }, required: ["story_id"], additionalProperties: false },
    handler: (args, tree) => {
      const story = tree.stories.find((candidate) => candidate.id === args.story_id);
      if (!story) throw new Error(`No story with id ${String(args.story_id)}. Use list_stories for ids.`);
      const people = story.personIds.map((id) => tree.people.find((person) => person.id === id)?.displayName).filter(Boolean);
      return [
        `# ${story.title}`,
        story.date ? `Date: ${story.date}` : "", story.place ? `Place: ${story.place}` : "",
        people.length ? `People: ${people.join(", ")}` : "",
        "", story.body,
        story.originalBody ? `\n---\nOriginal:\n${story.originalBody}` : "",
      ].filter((line) => line !== "").join("\n");
    },
  },
];

/* The intent tools: the questions families actually ask, not record CRUD.
 * Grounded in what people bring to any family tree - "how am I related to
 * her", "what was his life like", "where do we come from", "who am I named
 * after", "whose birthday is coming" - the questions incumbent genealogy
 * APIs cannot answer because they stop at persons-and-relationships. */
export const MCP_INTENT_TOOLS: McpTool[] = [
  {
    name: "how_am_i_related",
    description: "How the connected member is related to a named person, in kinship words (\"your second cousin once removed\") from their own point of view. The single most-asked family question - prefer this over relationship_path when the asker means themselves.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, person_id: { type: "string" } }, additionalProperties: false },
    handler: (args, tree, context) => kinshipToEgo(tree, context.egoId, resolvePerson(tree, args).id),
  },
  {
    name: "life_of",
    description: "A person's life told in order - birth, parents, marriages, children, places, stories, death and age - rather than a field dump. Use for \"what was her life like?\" and for introducing a person.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, person_id: { type: "string" } }, additionalProperties: false },
    handler: (args, tree) => lifeStory(tree, resolvePerson(tree, args).id),
  },
  {
    name: "family_origins",
    description: "Where the family comes from: recorded birth places by generation, oldest first, so migrations read as movement. Answers \"where are we from?\".",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, tree) => familyOrigins(tree),
  },
  {
    name: "family_in_year",
    description: "A snapshot of the family in a given year: who was born, who died, who was alive and their ages. Answers \"what was the family like when …\".",
    inputSchema: { type: "object", properties: { year: { type: "integer" } }, required: ["year"], additionalProperties: false },
    handler: (args, tree) => {
      const when = Number(args.year);
      if (!Number.isInteger(when) || when < 1000 || when > 3000) throw new Error("Give a four-digit year.");
      return familyInYear(tree, when);
    },
  },
  {
    name: "namesakes",
    description: "Everyone who carries a given name across the generations, eldest line first. Answers \"who am I named after?\" - names handed down usually honour the earlier bearer.",
    inputSchema: { type: "object", properties: { given_name: { type: "string" } }, required: ["given_name"], additionalProperties: false },
    handler: (args, tree) => namesakes(tree, String(args.given_name ?? "")),
  },
  {
    name: "upcoming_family_dates",
    description: "Birthdays of the living and remembrance anniversaries in the next month, from fully dated records.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, tree) => upcomingDates(tree),
  },
];
MCP_TOOLS.push(...MCP_INTENT_TOOLS);

export function findMcpTool(name: string): McpTool | null {
  return MCP_TOOLS.find((candidate) => candidate.name === name) ?? null;
}
