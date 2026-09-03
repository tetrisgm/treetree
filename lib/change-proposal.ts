import type { ChangeProposal, Person } from "./types";

const MAX_SUMMARY = 500;
const MAX_ID = 200;
const MAX_NAME = 300;
const MAX_DATE = 100;
const MAX_LOCATION = 500;
const MAX_BIOGRAPHY = 50_000;
const MAX_STORY_TITLE = 500;
const MAX_STORY_BODY = 200_000;
// Each link becomes its own D1 statement. Keep one proposal comfortably below
// the invocation ceiling after validation reads, the audit row, and the final
// tree refresh are included. Larger imports must be split into bounded work.
const MAX_STORY_LINKS = 32;
const MAX_RELATIONSHIP_HINTS = 16;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.trim().length > 0);
}

function hasNullableText(record: UnknownRecord, key: string, maximum: number): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return false;
  const value = record[key];
  return value === null || isText(value, maximum, true);
}

function hasOptionalNullableText(record: UnknownRecord, key: string, maximum: number): boolean {
  const value = record[key];
  return value === undefined || value === null || isText(value, maximum, true);
}

const personTextLimits: ReadonlyArray<readonly [keyof Omit<Person, "id">, number]> = [
  ["givenName", MAX_NAME],
  ["familyName", MAX_NAME],
  ["maidenName", MAX_NAME],
  ["birthDate", MAX_DATE],
  ["deathDate", MAX_DATE],
  ["birthPlace", MAX_LOCATION],
  ["deathPlace", MAX_LOCATION],
  ["birthCity", MAX_LOCATION],
  ["birthCountry", MAX_LOCATION],
  ["deathCity", MAX_LOCATION],
  ["deathCountry", MAX_LOCATION],
  ["burialPlace", MAX_LOCATION],
  ["residence", MAX_LOCATION],
  ["biography", MAX_BIOGRAPHY],
  ["photoAttachmentId", MAX_ID],
];

function isPersonPayload(value: unknown): value is Omit<Person, "id"> {
  if (!isRecord(value) || !isText(value.displayName, MAX_NAME)) return false;
  if (value.gender !== undefined && value.gender !== null && value.gender !== "male" && value.gender !== "female") return false;
  return personTextLimits.every(([key, maximum]) => hasNullableText(value, key, maximum));
}

function isId(value: unknown): value is string {
  return isText(value, MAX_ID);
}

function isNullableText(value: unknown, maximum: number): value is string | null {
  return value === null || isText(value, maximum, true);
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isId);
}

function hasSummary(value: UnknownRecord): boolean {
  return isText(value.summary, MAX_SUMMARY);
}

function hasStoryFields(value: UnknownRecord): boolean {
  return isText(value.title, MAX_STORY_TITLE)
    && isText(value.body, MAX_STORY_BODY)
    && Object.prototype.hasOwnProperty.call(value, "date")
    && isNullableText(value.date, MAX_DATE)
    && Object.prototype.hasOwnProperty.call(value, "place")
    && isNullableText(value.place, MAX_LOCATION)
    && isIdList(value.personIds)
    && isIdList(value.attachmentIds)
    && value.personIds.length + value.attachmentIds.length <= MAX_STORY_LINKS;
}

/**
 * Runtime guard for the editor/agent mutation boundary. TypeScript types do
 * not validate JSON, and applyProposal performs full-row writes for people,
 * so accepting a partial object here can erase fields that were merely absent.
 */
export function isChangeProposal(value: unknown): value is ChangeProposal {
  if (!isRecord(value) || !hasSummary(value) || typeof value.kind !== "string") return false;

  if (value.kind === "add_person") {
    if (!isPersonPayload(value.person)) return false;
    if (value.relationshipHints === undefined) return true;
    return Array.isArray(value.relationshipHints)
      && value.relationshipHints.length <= MAX_RELATIONSHIP_HINTS
      && value.relationshipHints.every((hint) => isRecord(hint)
        && isText(hint.personName, MAX_NAME)
        && (hint.relationshipType === "parent" || hint.relationshipType === "spouse"));
  }

  if (value.kind === "update_person") return isId(value.personId) && isPersonPayload(value.patch);
  if (value.kind === "delete_person") return isId(value.personId);
  if (value.kind === "delete_relationship") return isId(value.relationshipId);
  if (value.kind === "merge_people") return isId(value.sourcePersonId) && isId(value.targetPersonId) && value.sourcePersonId !== value.targetPersonId;
  if (value.kind === "delete_story") return isId(value.storyId);
  if (value.kind === "delete_attachment") return isId(value.attachmentId);

  if (value.kind === "add_relationship") {
    if (value.relationshipType !== "parent" && value.relationshipType !== "spouse") return false;
    if (!isText(value.fromPersonId, MAX_ID, true) || !isText(value.toPersonId, MAX_ID, true)) return false;
    if (!hasOptionalNullableText(value, "fromPersonName", MAX_NAME) || !hasOptionalNullableText(value, "toPersonName", MAX_NAME)) return false;
    const hasFrom = value.fromPersonId.trim().length > 0 || (typeof value.fromPersonName === "string" && value.fromPersonName.trim().length > 0);
    const hasTo = value.toPersonId.trim().length > 0 || (typeof value.toPersonName === "string" && value.toPersonName.trim().length > 0);
    return hasFrom && hasTo;
  }

  if (value.kind === "add_story") return hasStoryFields(value);
  if (value.kind === "update_story") return isId(value.storyId) && hasStoryFields(value);
  return false;
}
