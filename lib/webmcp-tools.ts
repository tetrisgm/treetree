/** WebMCP tools: the archive's tools offered to a browser-side agent
 * (Chrome/Edge navigator.modelContext) that is driving this page.
 *
 * Unlike the hosted MCP server, these run inside the signed-in member's own
 * browser, so they need no OAuth - they act with the session already on the
 * page. And unlike a hosted server, they can move the live UI: focus a
 * person, switch views, ask the archivist in place. That is the thing a
 * remote MCP server fundamentally cannot do, so WebMCP leans into it.
 *
 * These builders are pure: each returns text plus optional side effects
 * described as calls into `actions`. The useWebMcp hook adapts them to the
 * navigator.modelContext.registerTool contract and supplies the live tree
 * and action callbacks. Kept framework-free so it is unit-testable.
 */

import type { FamilyTree, Person } from "./types";
import { describeRelationship, relationshipSentence } from "./relationship-path";
import { familyInYear, familyOrigins, kinshipToEgo, lifeStory, namesakes, upcomingDates } from "./family-answers";

export type WebMcpView = "tree" | "family" | "list" | "timeline" | "calendar" | "map" | "stats" | "fill";

export type WebMcpActions = {
  focusPerson: (person: Person) => void;
  setView: (view: WebMcpView) => void;
  askArchivist: (question: string) => Promise<string>;
  /** the person in the tree the signed-in viewer says they are, when known */
  egoId: string | null;
};

type JsonSchema = Record<string, unknown>;
export type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (args: Record<string, unknown>, tree: FamilyTree, actions: WebMcpActions) => Promise<string> | string;
};

const lifespan = (person: Person) => {
  const born = person.birthDate?.slice(0, 4);
  const died = person.deathDate?.slice(0, 4);
  return born || died ? ` (${born ?? "?"}–${died ?? ""})` : "";
};
const brief = (person: Person) => `${person.displayName}${lifespan(person)}`;

const findByName = (tree: FamilyTree, query: string): Person[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const exact = tree.people.filter((person) => person.displayName.toLowerCase() === needle);
  return exact.length ? exact : tree.people.filter((person) => person.displayName.toLowerCase().includes(needle));
};

const resolveOne = (tree: FamilyTree, query: string): Person => {
  const matches = findByName(tree, query);
  if (!matches.length) throw new Error(`No one named "${query}" is in the tree. Try search_family first.`);
  if (matches.length > 1) throw new Error(`Several people match "${query}": ${matches.slice(0, 8).map(brief).join("; ")}. Ask again with a fuller name.`);
  return matches[0];
};

const relativesOf = (tree: FamilyTree, id: string) => {
  const parents: Person[] = [], children: Person[] = [], spouses: Person[] = [];
  for (const link of tree.relationships) {
    if (link.type === "parent" && link.toPersonId === id) { const p = tree.people.find((c) => c.id === link.fromPersonId); if (p) parents.push(p); }
    if (link.type === "parent" && link.fromPersonId === id) { const c = tree.people.find((c) => c.id === link.toPersonId); if (c) children.push(c); }
    if (link.type === "spouse" && (link.fromPersonId === id || link.toPersonId === id)) {
      const other = tree.people.find((c) => c.id === (link.fromPersonId === id ? link.toPersonId : link.fromPersonId));
      if (other) spouses.push(other);
    }
  }
  return { parents, children, spouses };
};

export const WEBMCP_TOOLS: WebMcpTool[] = [
  {
    name: "overview_of_family_tree",
    description: "Summarize this family archive: how many people, relationships, and stories it holds and the span of recorded births. Use this to orient before other tools.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: (_args, tree) => {
      const years = tree.people.map((p) => Number(p.birthDate?.slice(0, 4))).filter((y) => Number.isFinite(y));
      return [
        `This archive holds ${tree.people.length} people, ${tree.relationships.length} relationships, and ${tree.stories.length} stories.`,
        years.length ? `Recorded births span ${Math.min(...years)}–${Math.max(...years)}.` : "",
      ].filter(Boolean).join(" ");
    },
  },
  {
    name: "search_family",
    description: "Find people in the tree whose name contains the query (case-insensitive). Returns names with lifespans; use these to pick an exact name for other tools.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Part of a name, in any script the archive uses." } }, required: ["query"], additionalProperties: false },
    execute: (args, tree) => {
      const matches = findByName(tree, String(args.query ?? ""));
      if (!matches.length) return `No one matching "${args.query}" is recorded.`;
      return matches.slice(0, 25).map((p) => `- ${brief(p)}`).join("\n");
    },
  },
  {
    name: "person_details",
    description: "The full record of one person by name: vital facts, parents, spouses, children, and the stories they appear in.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    execute: (args, tree) => {
      const person = resolveOne(tree, String(args.name ?? ""));
      const { parents, children, spouses } = relativesOf(tree, person.id);
      const stories = tree.stories.filter((story) => story.personIds.includes(person.id));
      const lines = [`${person.displayName}${lifespan(person)}`];
      if (person.birthDate || person.birthCity || person.birthCountry || person.birthPlace) lines.push(`Born: ${[person.birthDate, person.birthCity ?? person.birthPlace, person.birthCountry].filter(Boolean).join(", ")}`);
      if (person.deathDate || person.deathCity || person.deathCountry || person.deathPlace) lines.push(`Died: ${[person.deathDate, person.deathCity ?? person.deathPlace, person.deathCountry].filter(Boolean).join(", ")}`);
      if (person.residence) lines.push(`Lives in: ${person.residence}`);
      if (person.biography) lines.push(`Biography: ${person.biography}`);
      if (parents.length) lines.push(`Parents: ${parents.map(brief).join("; ")}`);
      if (spouses.length) lines.push(`Spouses: ${spouses.map(brief).join("; ")}`);
      if (children.length) lines.push(`Children: ${children.map(brief).join("; ")}`);
      if (stories.length) lines.push(`Stories: ${stories.map((s) => s.title).join("; ")}`);
      return lines.join("\n");
    },
  },
  {
    name: "how_are_they_related",
    description: "Explain how two people in the tree are related, by name.",
    inputSchema: { type: "object", properties: { person_a: { type: "string" }, person_b: { type: "string" } }, required: ["person_a", "person_b"], additionalProperties: false },
    execute: (args, tree) => {
      const a = resolveOne(tree, String(args.person_a ?? ""));
      const b = resolveOne(tree, String(args.person_b ?? ""));
      const result = describeRelationship(tree, a.id, b.id);
      return result ? relationshipSentence(result) : `The archive records no connection between ${a.displayName} and ${b.displayName}.`;
    },
  },
  {
    name: "show_person_on_canvas",
    description: "Move the on-screen family tree to centre on a person and open their record, so the human looking at the page sees who you mean. Use this to point at people as you discuss them.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    execute: (args, tree, actions) => {
      const person = resolveOne(tree, String(args.name ?? ""));
      actions.setView("tree");
      actions.focusPerson(person);
      return `Now showing ${person.displayName} on the family canvas.`;
    },
  },
  {
    name: "switch_view",
    description: "Change which view of the archive is on screen: tree (the canvas), family (pedigree), list, timeline, calendar, map, or stats.",
    inputSchema: { type: "object", properties: { view: { type: "string", enum: ["tree", "family", "list", "timeline", "calendar", "map", "stats"] } }, required: ["view"], additionalProperties: false },
    execute: (args, _tree, actions) => {
      const view = args.view as WebMcpView;
      actions.setView(view);
      return `Switched to the ${view} view.`;
    },
  },
  {
    name: "how_am_i_related",
    description: "How the person using this page is related to someone in the tree, in kinship words from their own point of view. Prefer this when they ask about themselves.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    execute: (args, tree, actions) => kinshipToEgo(tree, actions.egoId, resolveOne(tree, String(args.name ?? "")).id),
  },
  {
    name: "life_of",
    description: "A person's life told in order - birth, parents, marriages, children, places, stories, death - rather than a field dump.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    execute: (args, tree) => lifeStory(tree, resolveOne(tree, String(args.name ?? "")).id),
  },
  {
    name: "family_origins",
    description: "Where the family comes from: recorded birth places by generation, oldest first, so migrations read as movement.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: (_args, tree) => familyOrigins(tree),
  },
  {
    name: "family_in_year",
    description: "A snapshot of the family in a given year: births, deaths, who was alive and their ages.",
    inputSchema: { type: "object", properties: { year: { type: "integer" } }, required: ["year"], additionalProperties: false },
    execute: (args, tree) => familyInYear(tree, Number(args.year)),
  },
  {
    name: "namesakes",
    description: "Everyone who carries a given name across the generations - answers \"who am I named after?\".",
    inputSchema: { type: "object", properties: { given_name: { type: "string" } }, required: ["given_name"], additionalProperties: false },
    execute: (args, tree) => namesakes(tree, String(args.given_name ?? "")),
  },
  {
    name: "upcoming_family_dates",
    description: "Birthdays of the living and remembrance anniversaries in the next month.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: (_args, tree) => upcomingDates(tree),
  },
  {
    name: "ask_the_archivist",
    description: "Ask the archive's own AI archivist a free-form question about the family and return its answer. Use for anything the structured tools above do not cover.",
    inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false },
    execute: async (args, _tree, actions) => {
      const question = String(args.question ?? "").trim();
      if (!question) throw new Error("Ask a question.");
      return actions.askArchivist(question);
    },
  },
];
