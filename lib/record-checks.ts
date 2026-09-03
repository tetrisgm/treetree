import type { FamilyTree, Person } from "./types";

/** A problem the records contain but cannot settle on their own: an
 * impossibility, a contradiction between a field and a story, or two records
 * that may be one person. Each becomes a question in the Fill-in queue. */
export type RecordCheck = {
  /** stable across runs, so answering one keeps it answered */
  id: string;
  kind: "impossible" | "conflict" | "duplicate";
  question: string;
  evidence: string;
  personIds: string[];
  /** the two readings on offer, so the answer is a button not an essay */
  choices?: { label: string; verdict: "confirm" | "deny" }[];
};

const year = (value: string | null | undefined) => {
  const parsed = Number(String(value ?? "").slice(0, 4));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const label = (person: Person) => {
  const born = year(person.birthDate), died = year(person.deathDate);
  const life = born && died ? `${born}–${died}` : born ? `b. ${born}` : died ? `d. ${died}` : "no dates";
  return `${person.displayName} (${life})`;
};
const slug = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const MAX_AGE = 110;

/** Every check is a statement about recorded values only: nothing here guesses
 * what is true, it only reports what cannot all be true at once. */
export function runRecordChecks(tree: FamilyTree): RecordCheck[] {
  const checks: RecordCheck[] = [];
  const byId = new Map(tree.people.map((person) => [person.id, person]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const link of tree.relationships) {
    if (link.type !== "parent") continue;
    parentsOf.set(link.toPersonId, [...(parentsOf.get(link.toPersonId) ?? []), link.fromPersonId]);
    childrenOf.set(link.fromPersonId, [...(childrenOf.get(link.fromPersonId) ?? []), link.toPersonId]);
  }

  for (const person of tree.people) {
    const born = year(person.birthDate), died = year(person.deathDate);
    if (born && died && died < born) {
      checks.push({ id: `chk-died-before-born-${person.id}`, kind: "impossible", personIds: [person.id],
        choices: [{ label: "Noted — an editor will fix it", verdict: "confirm" }, { label: "The dates are right", verdict: "deny" }],
        question: `${person.displayName}'s death is recorded before their birth. Which date is wrong?`,
        evidence: `The record says born ${person.birthDate}, died ${person.deathDate}.` });
    }
    if (born && died && died - born > MAX_AGE) {
      checks.push({ id: `chk-lifespan-${person.id}`, kind: "impossible", personIds: [person.id],
        question: `${person.displayName} is recorded as living ${died - born} years. Is one of the dates wrong?`,
        evidence: `The record says born ${person.birthDate}, died ${person.deathDate}.` });
    }
    // a parent's dates against each child's
    for (const childId of childrenOf.get(person.id) ?? []) {
      const child = byId.get(childId);
      const childBorn = year(child?.birthDate);
      if (!child || !childBorn) continue;
      if (born && childBorn < born) {
        checks.push({ id: `chk-child-before-parent-${person.id}-${childId}`, kind: "impossible", personIds: [person.id, childId],
          question: `${child.displayName} is recorded as born before their parent ${person.displayName}. Which date is wrong?`,
          evidence: `${label(person)} is recorded as the parent of ${label(child)}.` });
      } else if (born && childBorn - born < 12) {
        checks.push({ id: `chk-young-parent-${person.id}-${childId}`, kind: "impossible", personIds: [person.id, childId],
          question: `${person.displayName} would have been ${childBorn - born} when ${child.displayName} was born. Is a date or the relationship wrong?`,
          evidence: `${label(person)} is recorded as the parent of ${label(child)}.` });
      }
      // a mother cannot bear a child after her death; a father has nine months
      if (died && childBorn > died + (person.gender === "female" ? 0 : 1)) {
        checks.push({ id: `chk-posthumous-${person.id}-${childId}`, kind: "impossible", personIds: [person.id, childId],
          question: `${child.displayName} is recorded as born ${childBorn - died} years after ${person.displayName} died. Which is wrong?`,
          evidence: `${label(person)} is recorded as the parent of ${label(child)}.` });
      }
    }
  }

  // A field and a story disagreeing about the same fact. The claim is credited
  // only to the story's subject - the linked person the title names - because a
  // life account mentions many people and a loose name match would blame all of
  // them for one sentence.
  for (const story of tree.stories) {
    const title = slug(story.title);
    const subject = story.personIds.map((id) => byId.get(id)).find((person) => person && title.startsWith(slug(person.displayName).split("-").slice(0, 2).join("-")));
    const born = year(subject?.birthDate), died = year(subject?.deathDate);
    if (!subject || !born || !died) continue;
    if (/(?:over|more than) a hundred|over 100 years/i.test(story.body) && died - born < 100) {
      checks.push({ id: `chk-story-age-${story.id}-${subject.id}`, kind: "conflict", personIds: [subject.id],
        question: `Was ${subject.displayName} over a hundred when he died, or ${died - born} as the dates say?`,
        evidence: `The story “${story.title}” says he was over a hundred years old, but the record has ${subject.birthDate}–${subject.deathDate}, which is ${died - born} years.`,
        choices: [{ label: "Over a hundred", verdict: "confirm" }, { label: `${died - born}, as recorded`, verdict: "deny" }] });
    }
  }

  // two records that may be one person: same name, no shared parents, and
  // nothing in their dates that rules out a merge
  const byName = new Map<string, Person[]>();
  for (const person of tree.people) {
    const key = slug(person.displayName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), person]);
  }
  for (const [key, group] of byName) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const [a, b] = [group[i], group[j]];
        const parentsA = new Set(parentsOf.get(a.id) ?? []);
        const parentsB = parentsOf.get(b.id) ?? [];
        // different recorded parents mean the archive already distinguishes them
        if (parentsB.some((id) => parentsA.has(id))) continue;
        const bothPlaced = parentsA.size > 0 && parentsB.length > 0;
        const bornA = year(a.birthDate), bornB = year(b.birthDate);
        const datesDiffer = bornA && bornB && Math.abs(bornA - bornB) > 3;
        if (bothPlaced || datesDiffer) continue;
        checks.push({ id: `chk-duplicate-${key}-${[a.id, b.id].sort().join("-")}`, kind: "duplicate", personIds: [a.id, b.id],
          choices: [{ label: "Yes, one person", verdict: "confirm" }, { label: "No, two people", verdict: "deny" }],
          question: `Are these two records the same person: ${label(a)} and ${label(b)}?`,
          evidence: `Both are recorded as “${a.displayName}”. ${parentsA.size ? "One has recorded parents and the other does not" : parentsB.length ? "One has recorded parents and the other does not" : "Neither has recorded parents"}, so the archive cannot tell them apart on its own.` });
      }
    }
  }
  return checks;
}
