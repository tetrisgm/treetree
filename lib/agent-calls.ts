import type { AgentConflict, ChangeProposal, Person } from "./types";

/** Turning the archivist's tool calls into proposals the archive can apply.
 *
 * Shared by the editor's chat and the ingestion queue, which must read the
 * same call the same way - a document read without anyone watching cannot
 * afford a second interpretation. */

type ToolCall = { name: string; arguments: string };

export function personFromArgs(args: Record<string, unknown>): Omit<Person, "id"> {
  return {
    displayName: String(args.display_name ?? ""),
    gender: args.gender as "male" | "female" | null,
    givenName: args.given_name as string | null,
    familyName: args.family_name as string | null,
  maidenName: (args.maiden_name as string | null) ?? null,
    birthDate: args.birth_date as string | null,
    deathDate: args.death_date as string | null,
    birthPlace: args.birth_place as string | null,
    deathPlace: args.death_place as string | null,
    birthCity: args.birth_city as string | null,
    birthCountry: args.birth_country as string | null,
    deathCity: args.death_city as string | null,
    deathCountry: args.death_country as string | null,
    burialPlace: (args.burial_place as string | null) ?? null,
    residence: (args.residence as string | null) ?? null,
    biography: args.biography as string | null,
    photoAttachmentId: args.photo_attachment_id as string | null,
  };
}

export function proposalFromCall(call: ToolCall): ChangeProposal | null {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.arguments) as Record<string, unknown>; } catch { return null; }
  const summary = String(args.summary ?? "Suggested family-tree change");
  if (call.name === "propose_add_person") return { kind: "add_person", summary, person: personFromArgs(args), relationshipHints: Array.isArray(args.relationship_hints) ? args.relationship_hints.map((hint) => ({ personName: String((hint as Record<string, unknown>).person_name ?? ""), relationshipType: (hint as Record<string, unknown>).relationship_type as "parent" | "spouse" })) : [] };
  if (call.name === "propose_update_person") return {
    kind: "update_person", summary, personId: String(args.person_id ?? ""), patch: personFromArgs(args),
  };
  if (call.name === "propose_add_relationship") return {
    kind: "add_relationship", summary, fromPersonId: String(args.from_person_id ?? ""),
    toPersonId: String(args.to_person_id ?? ""), fromPersonName: args.from_person_name as string | null,
    toPersonName: args.to_person_name as string | null, relationshipType: args.relationship_type as "parent" | "spouse",
  };
  if (call.name === "propose_add_story") return {
    kind: "add_story", summary, title: String(args.title ?? "Family story"), body: String(args.body ?? ""),
    date: args.date as string | null, place: args.place as string | null,
    personIds: Array.isArray(args.person_ids) ? args.person_ids.map(String) : [],
    attachmentIds: Array.isArray(args.attachment_ids) ? args.attachment_ids.map(String) : [],
  };
  if (call.name === "propose_delete_person") return { kind: "delete_person", summary, personId: String(args.person_id ?? "") };
  if (call.name === "propose_merge_people") return { kind: "merge_people", summary, sourcePersonId: String(args.source_person_id ?? ""), targetPersonId: String(args.target_person_id ?? "") };
  if (call.name === "propose_delete_relationship") return { kind: "delete_relationship", summary, relationshipId: String(args.relationship_id ?? "") };
  if (call.name === "propose_update_story") return {
    kind: "update_story", summary, storyId: String(args.story_id ?? ""), title: String(args.title ?? "Family story"), body: String(args.body ?? ""),
    date: args.date as string | null, place: args.place as string | null,
    personIds: Array.isArray(args.person_ids) ? args.person_ids.map(String) : [],
    attachmentIds: Array.isArray(args.attachment_ids) ? args.attachment_ids.map(String) : [],
  };
  if (call.name === "propose_delete_story") return { kind: "delete_story", summary, storyId: String(args.story_id ?? "") };
  if (call.name === "propose_delete_attachment") return { kind: "delete_attachment", summary, attachmentId: String(args.attachment_id ?? "") };
  return null;
}

export function conflictFromCall(call: ToolCall): AgentConflict | null {
  if (call.name !== "request_clarification") return null;
  try {
    const args = JSON.parse(call.arguments) as Record<string, unknown>;
    return {
      question: String(args.question ?? "Could you clarify which person you mean?"),
      reason: String(args.reason ?? "The records contain conflicting identity evidence."),
      candidatePersonIds: Array.isArray(args.candidate_person_ids) ? args.candidate_person_ids.map(String) : [],
      evidence: Array.isArray(args.evidence) ? args.evidence.map(String) : [],
    };
  } catch { return null; }
}

export type AgentUiAction =
  | { type: "show_person"; displayName: string }
  | { type: "switch_view"; view: "tree" | "family" | "list" | "timeline" | "calendar" | "map" | "stats" };

/** UI tools are the page's to execute, not the archive's to apply: the route
 * returns them and the client moves the canvas. */
export function uiActionFromCall(call: ToolCall): AgentUiAction | null {
  try {
    const args = JSON.parse(call.arguments) as Record<string, unknown>;
    if (call.name === "show_person" && typeof args.display_name === "string" && args.display_name.trim()) {
      return { type: "show_person", displayName: args.display_name.trim() };
    }
    if (call.name === "switch_view" && ["tree", "family", "list", "timeline", "calendar", "map", "stats"].includes(String(args.view))) {
      return { type: "switch_view", view: args.view as AgentUiAction extends { view: infer V } ? V : never };
    }
  } catch { /* malformed arguments are dropped like every other bad call */ }
  return null;
}
