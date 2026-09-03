import type { FamilyTree } from "./types";
import { archiveName, archiveSlug, publicOrigin } from "./archive-config";

/** GEDCOM 5.5.1 - the interchange format every genealogy program reads.
 * Exporting it is the archive's insurance policy: whatever happens to this
 * site, the family's data opens in Ancestry, Gramps, MyHeritage or Reunion. */

const escape = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** GEDCOM lines cap at 255 characters; long text continues with CONC. */
function textLines(level: number, tag: string, value: string): string[] {
  const lines: string[] = [];
  for (const [index, paragraph] of value.split(/\r?\n/).entries()) {
    let rest = paragraph;
    let first = true;
    do {
      const chunk = rest.slice(0, 200);
      rest = rest.slice(200);
      lines.push(`${first ? level : level + 1} ${first ? (index === 0 ? tag : "CONT") : "CONC"} ${chunk}`);
      first = false;
    } while (rest.length);
  }
  return lines;
}

/** YYYY, YYYY-MM and YYYY-MM-DD become GEDCOM's day-month-year form. */
function gedcomDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
  if (!match) return escape(value);
  const [, year, month, day] = match;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthName = month ? months[Number(month) - 1] : null;
  return [day ? String(Number(day)) : null, monthName, year].filter(Boolean).join(" ");
}

const placeOf = (city: string | null, country: string | null, fallback: string | null) =>
  [city, country].filter(Boolean).join(", ") || fallback || null;

export function buildGedcom(tree: FamilyTree, origin = publicOrigin(), sourceName = archiveName(), sourceId = archiveSlug().toUpperCase().replace(/-/g, "_")): string {
  const lines: string[] = [];
  const xref = new Map<string, string>();
  tree.people.forEach((person, index) => xref.set(person.id, `@I${index + 1}@`));

  // families are the unit GEDCOM records: a couple, or a lone parent, plus children
  const parentsOf = new Map<string, string[]>();
  for (const link of tree.relationships) {
    if (link.type !== "parent") continue;
    parentsOf.set(link.toPersonId, [...(parentsOf.get(link.toPersonId) ?? []), link.fromPersonId]);
  }
  const families = new Map<string, { parents: string[]; children: string[]; status: string | null }>();
  const familyKey = (parents: string[]) => [...parents].sort().join("+");
  for (const [childId, parents] of parentsOf) {
    const key = familyKey(parents);
    const family = families.get(key) ?? { parents: [...parents].sort(), children: [], status: null };
    family.children.push(childId);
    families.set(key, family);
  }
  for (const link of tree.relationships) {
    if (link.type !== "spouse") continue;
    const key = familyKey([link.fromPersonId, link.toPersonId]);
    const family = families.get(key) ?? { parents: [link.fromPersonId, link.toPersonId].sort(), children: [], status: null };
    family.status = link.status ?? null;
    families.set(key, family);
  }
  const familyXref = new Map<string, string>();
  [...families.keys()].forEach((key, index) => familyXref.set(key, `@F${index + 1}@`));

  lines.push("0 HEAD", `1 SOUR ${sourceId}`, `2 NAME ${sourceName}`, `2 CORP ${origin}`,
    "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8",
    `1 DATE ${gedcomDate(new Date().toISOString().slice(0, 10))}`);

  for (const person of tree.people) {
    lines.push(`0 ${xref.get(person.id)} INDI`);
    const parts = person.displayName.trim().split(/\s+/).filter((token) => !/^\(.*\)$/.test(token));
    const surname = parts.length > 1 ? parts.slice(1).join(" ") : "";
    lines.push(`1 NAME ${escape(parts[0] ?? person.displayName)} /${escape(surname)}/`);
    if (person.maidenName) lines.push(`2 SURN ${escape(person.maidenName)}`);
    if (person.gender) lines.push(`1 SEX ${person.gender === "male" ? "M" : "F"}`);
    const birthDate = gedcomDate(person.birthDate);
    const birthPlace = placeOf(person.birthCity, person.birthCountry, person.birthPlace);
    if (birthDate || birthPlace) {
      lines.push("1 BIRT");
      if (birthDate) lines.push(`2 DATE ${birthDate}`);
      if (birthPlace) lines.push(`2 PLAC ${escape(birthPlace)}`);
    }
    const deathDate = gedcomDate(person.deathDate);
    const deathPlace = placeOf(person.deathCity, person.deathCountry, person.deathPlace);
    if (deathDate || deathPlace) {
      lines.push("1 DEAT");
      if (deathDate) lines.push(`2 DATE ${deathDate}`);
      if (deathPlace) lines.push(`2 PLAC ${escape(deathPlace)}`);
    }
    if (person.residence) { lines.push("1 RESI", `2 PLAC ${escape(person.residence)}`); }
    if (person.burialPlace) { lines.push("1 BURI", `2 PLAC ${escape(person.burialPlace)}`); }
    if (person.biography) lines.push(...textLines(1, "NOTE", person.biography));
    // stories this person appears in travel with them
    for (const story of tree.stories.filter((candidate) => candidate.personIds.includes(person.id))) {
      lines.push(...textLines(1, "NOTE", `${story.title}${story.date ? ` (${story.date})` : ""}\n${story.body}`));
    }
    for (const [key, family] of families) {
      if (family.children.includes(person.id)) lines.push(`1 FAMC ${familyXref.get(key)}`);
      if (family.parents.includes(person.id)) lines.push(`1 FAMS ${familyXref.get(key)}`);
    }
  }

  for (const [key, family] of families) {
    lines.push(`0 ${familyXref.get(key)} FAM`);
    const [first, second] = family.parents.map((id) => tree.people.find((person) => person.id === id));
    // GEDCOM wants husband and wife; recorded gender decides, otherwise order
    const husband = first?.gender === "female" ? second : first;
    const wife = husband === first ? second : first;
    if (husband) lines.push(`1 HUSB ${xref.get(husband.id)}`);
    if (wife) lines.push(`1 WIFE ${xref.get(wife.id)}`);
    for (const childId of family.children) lines.push(`1 CHIL ${xref.get(childId)}`);
    if (family.status === "divorced") lines.push("1 DIV Y");
    else if (family.parents.length === 2) lines.push("1 MARR");
  }

  lines.push("0 TRLR");
  return lines.join("\n") + "\n";
}
