import type { AddPersonProposal, AddRelationshipProposal, ChangeProposal, Person } from "./types";

type GedcomRecord = { xref: string | null; tag: string; value: string; children: GedcomRecord[] };
export type GedcomImportReport = {
  format: "GEDCOM";
  version: string | null;
  people: number;
  families: number;
  relationships: number;
  warnings: string[];
  proposals: ChangeProposal[];
};

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

function parseLine(line: string): { level: number; xref: string | null; tag: string; value: string } | null {
  const match = /^\s*(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s+(.*))?$/.exec(line);
  return match ? { level: Number(match[1]), xref: match[2] ?? null, tag: match[3].toUpperCase(), value: match[4]?.trim() ?? "" } : null;
}

function records(text: string): { roots: GedcomRecord[]; warnings: string[] } {
  const roots: GedcomRecord[] = [];
  const stack: Array<{ level: number; record: GedcomRecord }> = [];
  const warnings: string[] = [];
  for (const [index, raw] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    const parsed = parseLine(raw);
    if (!parsed) { warnings.push(`Line ${index + 1} could not be parsed.`); continue; }
    const record: GedcomRecord = { xref: parsed.xref, tag: parsed.tag, value: parsed.value, children: [] };
    while (stack.length && stack[stack.length - 1].level >= parsed.level) stack.pop();
    if (stack.length) stack[stack.length - 1].record.children.push(record); else roots.push(record);
    stack.push({ level: parsed.level, record });
  }
  return { roots, warnings };
}

function child(record: GedcomRecord, tag: string) { return record.children.find((item) => item.tag === tag); }
function children(record: GedcomRecord, tag: string) { return record.children.filter((item) => item.tag === tag); }
function textValue(record: GedcomRecord | undefined): string | null {
  if (!record) return null;
  let value = record.value;
  for (const continuation of record.children) {
    if (continuation.tag === "CONC") value += continuation.value;
    if (continuation.tag === "CONT") value += `\n${continuation.value}`;
  }
  return value.trim() || null;
}

/** Preserve qualified/ranged dates as source text; normalize unambiguous dates to ISO. */
export function parseGedcomDate(value: string | null): string | null {
  if (!value) return null;
  const exact = /^(?:(\d{1,2})\s+)?([A-Z]{3})\s+(\d{4})$/i.exec(value.trim());
  if (exact && MONTHS[exact[2].toUpperCase()]) return exact[1]
    ? `${exact[3]}-${MONTHS[exact[2].toUpperCase()]}-${exact[1].padStart(2, "0")}`
    : `${exact[3]}-${MONTHS[exact[2].toUpperCase()]}`;
  return /^\d{4}$/.test(value.trim()) ? value.trim() : value.trim();
}

function splitPlace(value: string | null): { city: string | null; country: string | null } {
  const parts = value?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  return { city: parts[0] ?? null, country: parts.length > 1 ? parts[parts.length - 1] : null };
}

function personFrom(record: GedcomRecord): Omit<Person, "id"> {
  const nameRecord = child(record, "NAME");
  const rawName = textValue(nameRecord) ?? "Unnamed person";
  const nameMatch = /^(.*?)\s*\/([^/]*)\/(.*)$/.exec(rawName);
  const givenName = (textValue(child(nameRecord ?? record, "GIVN")) ?? nameMatch?.[1] ?? "").trim() || null;
  const familyName = (textValue(child(nameRecord ?? record, "SURN")) ?? nameMatch?.[2] ?? "").trim() || null;
  const suffix = nameMatch?.[3]?.trim();
  const displayName = [givenName, familyName, suffix].filter(Boolean).join(" ") || rawName.replaceAll("/", "").trim();
  const birth = child(record, "BIRT"); const death = child(record, "DEAT");
  const birthPlace = textValue(child(birth ?? record, "PLAC")); const deathPlace = textValue(child(death ?? record, "PLAC"));
  const birthParts = splitPlace(birthPlace); const deathParts = splitPlace(deathPlace);
  const sex = textValue(child(record, "SEX"))?.toUpperCase();
  const notes = children(record, "NOTE").map(textValue).filter((value): value is string => Boolean(value));
  return {
    displayName, gender: sex === "M" ? "male" : sex === "F" ? "female" : null,
    givenName, familyName, maidenName: null,
    birthDate: parseGedcomDate(textValue(child(birth ?? record, "DATE"))),
    deathDate: parseGedcomDate(textValue(child(death ?? record, "DATE"))),
    birthPlace, deathPlace, birthCity: birthParts.city, birthCountry: birthParts.country,
    deathCity: deathParts.city, deathCountry: deathParts.country,
    burialPlace: textValue(child(child(record, "BURI") ?? record, "PLAC")),
    residence: textValue(child(child(record, "RESI") ?? record, "PLAC")),
    biography: notes.length ? notes.join("\n\n") : null, photoAttachmentId: null,
  };
}

export function parseGedcom(text: string): GedcomImportReport {
  const parsed = records(text);
  const individuals = parsed.roots.filter((record) => record.tag === "INDI" && record.xref);
  const families = parsed.roots.filter((record) => record.tag === "FAM");
  const people = new Map(individuals.map((record) => [record.xref as string, personFrom(record)]));
  const proposals: ChangeProposal[] = individuals.map((record): AddPersonProposal => ({
    kind: "add_person", summary: `Imported ${people.get(record.xref as string)?.displayName} from GEDCOM`,
    person: people.get(record.xref as string) as Omit<Person, "id">,
  }));
  const seen = new Set<string>();
  const addRelationship = (from: string, to: string, relationshipType: "parent" | "spouse") => {
    if (!people.has(from) || !people.has(to) || from === to) { parsed.warnings.push(`Skipped invalid ${relationshipType} link ${from} → ${to}.`); return; }
    const key = relationshipType === "spouse" ? `${relationshipType}:${[from, to].sort().join(":")}` : `${relationshipType}:${from}:${to}`;
    if (seen.has(key)) return; seen.add(key);
    proposals.push({ kind: "add_relationship", summary: `Imported ${relationshipType} relationship from GEDCOM`,
      fromPersonId: from, toPersonId: to, fromPersonName: people.get(from)?.displayName,
      toPersonName: people.get(to)?.displayName, relationshipType } satisfies AddRelationshipProposal);
  };
  for (const family of families) {
    const parents = [...children(family, "HUSB"), ...children(family, "WIFE")].map((record) => record.value).filter(Boolean);
    if (parents.length === 2) addRelationship(parents[0], parents[1], "spouse");
    for (const childRecord of children(family, "CHIL")) for (const parent of parents) addRelationship(parent, childRecord.value, "parent");
  }
  const version = textValue(child(parsed.roots.find((record) => record.tag === "HEAD") ?? { xref: null, tag: "", value: "", children: [] }, "GEDC")?.children.find((record) => record.tag === "VERS"));
  return { format: "GEDCOM", version, people: individuals.length, families: families.length,
    relationships: seen.size, warnings: parsed.warnings, proposals };
}
