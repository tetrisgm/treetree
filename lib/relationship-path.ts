import type { FamilyTree, Person } from "./types";
import type { Lang } from "./i18n";
import { kinshipLabel } from "./kinship-words";

/** How two people in the tree are related, in the words a family uses:
 * "your second cousin once removed", "your great-grandfather". Computed from
 * the recorded parent links, never guessed. */
export type RelationshipResult = {
  from: Person;
  to: Person;
  /** the family word for it, from `from`'s point of view */
  relationship: string;
  /** the people the connection runs through, `from` first and `to` last */
  path: Person[];
  /** the ancestors both descend from, when the link is by blood */
  sharedAncestors: Person[];
  /** generations up from `from` and down to `to` via the shared ancestor; 0/0 when not by blood */
  up?: number;
  down?: number;
  /** which of `from`'s parents the blood line runs through - the side a
   * family means by "paternal uncle", "on my mother's side"; null when the
   * line does not pass a parent of `from` or their gender is unrecorded */
  side?: "paternal" | "maternal" | null;
  /** the child of the shared ancestor on `to`'s line: the sibling a nephew
   * comes through, the aunt or uncle a cousin comes through */
  viaTheirs?: Person | null;
  /** for "your uncle's wife": how the blood relative they married is related */
  viaSpouseOf?: RelationshipResult | null;
  /** for "your husband's nephew": how they are related to the spouse one married */
  viaPartnerOf?: RelationshipResult | null;
  /** the spouse that phrase runs through */
  partner?: Person | null;
};

type RelationshipIndex = {
  byId: Map<string, Person>;
  parentsOf: Map<string, string[]>;
  childrenOf: Map<string, string[]>;
  spousesOf: Map<string, string[]>;
  neighboursOf: Map<string, string[]>;
  /* Every ancestor walk is the same walk: one person's line does not change
     between questions. Labelling a whole canvas asks about hundreds of pairs,
     and naming the in-laws asks again through each bridge, so the walk is
     computed once per person and kept. */
  ancestorCache: Map<string, Map<string, number>>;
  /* The same holds, and matters far more, for the walk that finds the trail
     between two people: one breadth-first sweep from a person reaches
     everybody, so labelling a canvas of hundreds from one seat is one sweep
     rather than hundreds. The map holds each node's predecessor. */
  trailCache: Map<string, Map<string, string | null>>;
};

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const greats = (steps: number, base: string) => steps <= 1 ? base : steps === 2 ? `grand${base}` : `${"great-".repeat(steps - 2)}grand${base}`;

const removedSuffix = (removed: number) => removed === 0 ? "" : removed === 1 ? " once removed" : removed === 2 ? " twice removed" : ` ${removed} times removed`;

/** ancestor id -> how many generations up, walking parent links */
function ancestorsOf(personId: string, parentsOf: Map<string, string[]>): Map<string, number> {
  const found = new Map<string, number>([[personId, 0]]);
  let frontier = [personId];
  let depth = 0;
  while (frontier.length && depth < 30) {
    depth += 1;
    const next: string[] = [];
    for (const id of frontier) {
      for (const parentId of parentsOf.get(id) ?? []) {
        if (found.has(parentId)) continue;
        found.set(parentId, depth);
        next.push(parentId);
      }
    }
    frontier = next;
  }
  return found;
}

function relationshipIndex(tree: FamilyTree): RelationshipIndex {
  const byId = new Map(tree.people.map((person) => [person.id, person]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  const neighboursOf = new Map<string, string[]>();
  const link = (map: Map<string, string[]>, from: string, to: string) => {
    const existing = map.get(from);
    if (existing) existing.push(to);
    else map.set(from, [to]);
  };
  for (const relationship of tree.relationships) {
    link(neighboursOf, relationship.fromPersonId, relationship.toPersonId);
    link(neighboursOf, relationship.toPersonId, relationship.fromPersonId);
    if (relationship.type === "parent") { link(parentsOf, relationship.toPersonId, relationship.fromPersonId); link(childrenOf, relationship.fromPersonId, relationship.toPersonId); }
    else if (relationship.type === "spouse") {
      link(spousesOf, relationship.fromPersonId, relationship.toPersonId);
      link(spousesOf, relationship.toPersonId, relationship.fromPersonId);
    }
  }
  return { byId, parentsOf, childrenOf, spousesOf, neighboursOf, ancestorCache: new Map(), trailCache: new Map() };
}

/** The words a family uses for the people who married in. "Related by
 * marriage, through Peter" is true and useless: English has daughter-in-law,
 * and so does every language this archive speaks. Only reached when no blood
 * line connects the two, so a step-child can never be one's own child. */
function inLawTerm(index: RelationshipIndex, fromId: string, to: Person): string | null {
  const { parentsOf, childrenOf, spousesOf } = index;
  const of = (map: Map<string, string[]>, id: string) => map.get(id) ?? [];
  const siblingsOf = (id: string) => [...new Set(of(parentsOf, id).flatMap((parentId) => of(childrenOf, parentId)))].filter((candidate) => candidate !== id);
  const male = to.gender === "male", female = to.gender === "female";
  const word = (m: string, f: string, n: string) => male ? m : female ? f : n;
  const mySpouses = of(spousesOf, fromId), myChildren = of(childrenOf, fromId), myParents = of(parentsOf, fromId);
  const theirSpouses = of(spousesOf, to.id);

  if (theirSpouses.some((id) => myChildren.includes(id))) return word("son-in-law", "daughter-in-law", "child's spouse");
  if (mySpouses.some((spouseId) => of(parentsOf, spouseId).includes(to.id))) return word("father-in-law", "mother-in-law", "spouse's parent");
  if (mySpouses.some((spouseId) => siblingsOf(spouseId).includes(to.id)) || theirSpouses.some((id) => siblingsOf(fromId).includes(id))) {
    return word("brother-in-law", "sister-in-law", "sibling-in-law");
  }
  if (myParents.some((parentId) => of(spousesOf, parentId).includes(to.id))) return word("step-father", "step-mother", "step-parent");
  if (mySpouses.some((spouseId) => of(childrenOf, spouseId).includes(to.id))) return word("step-son", "step-daughter", "step-child");
  return null;
}

function describeIndexedRelationship(index: RelationshipIndex, fromId: string, toId: string, viaBridge = false): RelationshipResult | null {
  const { byId, parentsOf, childrenOf, spousesOf, neighboursOf, ancestorCache, trailCache } = index;
  const ancestors = (personId: string) => {
    const cached = ancestorCache.get(personId);
    if (cached) return cached;
    const walked = ancestorsOf(personId, parentsOf);
    ancestorCache.set(personId, walked);
    return walked;
  };
  const from = byId.get(fromId), to = byId.get(toId);
  if (!from || !to) return null;
  if (fromId === toId) return { from, to, relationship: "the same person", path: [from], sharedAncestors: [] };

  const shortestPath = (): Person[] => {
    // Undirected walk over the pre-indexed parent and spouse links, for the
    // trail of names. Swept once per starting person and reused: stopping at
    // the target would save nothing, since the next question starts here too.
    let previous = trailCache.get(fromId);
    if (!previous) {
      previous = new Map<string, string | null>([[fromId, null]]);
      const queue = [fromId];
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        for (const nextId of neighboursOf.get(queue[cursor]) ?? []) {
          if (previous.has(nextId)) continue;
          previous.set(nextId, queue[cursor]);
          queue.push(nextId);
        }
      }
      trailCache.set(fromId, previous);
    }
    if (!previous.has(toId)) return [];
    const trail: Person[] = [];
    for (let cursor: string | null = toId; cursor; cursor = previous.get(cursor) ?? null) {
      const person = byId.get(cursor);
      if (person) trail.unshift(person);
    }
    return trail;
  };

  const mine = ancestors(fromId);
  const theirs = ancestors(toId);
  let best: { id: string; up: number; down: number } | null = null;
  for (const [id, up] of mine) {
    const down = theirs.get(id);
    if (down === undefined) continue;
    if (!best || up + down < best.up + best.down) best = { id, up, down };
  }

  const path = shortestPath();
  const spouseOfFrom = new Set(spousesOf.get(fromId) ?? []);
  const male = to.gender === "male", female = to.gender === "female";

  if (best) {
    const { up, down } = best;
    const sharedAncestors = [...mine.keys()]
      .filter((id) => theirs.get(id) === best!.down && mine.get(id) === best!.up)
      .map((id) => byId.get(id))
      .filter((person): person is Person => Boolean(person));
    const sharedIds = new Set(sharedAncestors.map((person) => person.id));
    // the side of the family is `from`'s own parent that the line climbs
    // through; the person a nephew or cousin "comes through" is the shared
    // ancestor's child on `to`'s line
    const parentOnLine = up >= 2 ? (parentsOf.get(fromId) ?? []).map((id) => byId.get(id)).find((parent) => parent && [...sharedIds].some((sharedId) => ancestors(parent.id).get(sharedId) === up - 1)) ?? null : null;
    const side = parentOnLine ? (parentOnLine.gender === "male" ? "paternal" : parentOnLine.gender === "female" ? "maternal" : null) : null;
    let viaTheirs: Person | null = null;
    if (down >= 1) for (const [id, steps] of theirs) {
      if (steps === down - 1 && (parentsOf.get(id) ?? []).some((parentId) => sharedIds.has(parentId))) { viaTheirs = byId.get(id) ?? null; break; }
    }
    let relationship: string;
    if (up === 0) relationship = greats(down, male ? "son" : female ? "daughter" : "child");
    else if (down === 0) relationship = greats(up, male ? "father" : female ? "mother" : "parent");
    else if (up === 1 && down === 1) relationship = male ? "brother" : female ? "sister" : "sibling";
    else if (up === 1) relationship = greats(down - 1, male ? "nephew" : female ? "niece" : "nephew or niece");
    else if (down === 1) relationship = greats(up - 1, male ? "uncle" : female ? "aunt" : "aunt or uncle");
    else {
      const cousinDegree = Math.min(up, down) - 1;
      const removed = Math.abs(up - down);
      relationship = `${ORDINALS[cousinDegree - 1] ?? `${cousinDegree}th`} cousin${removedSuffix(removed)}`;
    }
    // grandparents, aunts and uncles carry their side in English too: it is
    // the first thing a family asks ("which grandmother?")
    if (side && down <= 1 && up >= 2) relationship = `${side} ${relationship}`;
    return { from, to, relationship, path, sharedAncestors, up, down, side, viaTheirs };
  }

  if (spouseOfFrom.has(toId)) {
    return { from, to, relationship: male ? "husband" : female ? "wife" : "spouse", path, sharedAncestors: [] };
  }
  // related by marriage: someone on the path married in
  if (path.length) {
    const named = inLawTerm(index, fromId, to);
    if (named) return { from, to, relationship: named, path, sharedAncestors: [] };
    const throughSpouse = path.find((person, index) => index > 0 && index < path.length - 1 && (spousesOf.get(person.id) ?? []).some((id) => path.some((other) => other.id === id)));
    /* Beyond the named in-laws, the clearest thing to say is whose husband or
       wife they are: "your uncle's wife" beats "related by marriage, through
       Uncle". The bridge is described once, never recursively, so a chain of
       marriages still ends at the plain phrase. */
    const byBlood = (result: RelationshipResult | null) =>
      result && result.relationship !== "not connected in the records" && (result.sharedAncestors.length > 0 || (result.up ?? 0) + (result.down ?? 0) > 0) ? result : null;
    if (throughSpouse && !viaBridge) {
      // they married my relative: "your uncle's wife"
      if ((spousesOf.get(throughSpouse.id) ?? []).includes(toId)) {
        const bridge = byBlood(describeIndexedRelationship(index, fromId, throughSpouse.id, true));
        if (bridge) return { from, to, relationship: `${bridge.relationship}'s ${male ? "husband" : female ? "wife" : "spouse"}`, path, sharedAncestors: [], viaSpouseOf: bridge };
      }
      // I married their relative: "your husband's nephew"
      if ((spousesOf.get(fromId) ?? []).includes(throughSpouse.id)) {
        const theirs = byBlood(describeIndexedRelationship(index, throughSpouse.id, toId, true));
        if (theirs) {
          const partner = throughSpouse.gender === "male" ? "husband" : throughSpouse.gender === "female" ? "wife" : "spouse";
          return { from, to, relationship: `${partner}'s ${theirs.relationship}`, path, sharedAncestors: [], viaPartnerOf: theirs, partner: throughSpouse };
        }
      }
    }
    return {
      from, to,
      relationship: throughSpouse ? `related by marriage, through ${throughSpouse.displayName}` : "related by marriage",
      path, sharedAncestors: [],
    };
  }
  return { from, to, relationship: "not connected in the records", path: [], sharedAncestors: [] };
}

/** Build the immutable graph index once when several relationships are being
 * described from the same tree (for example, the names in one chat request). */
export function createRelationshipDescriber(tree: FamilyTree) {
  const index = relationshipIndex(tree);
  return (fromId: string, toId: string) => describeIndexedRelationship(index, fromId, toId);
}

export function describeRelationship(tree: FamilyTree, fromId: string, toId: string): RelationshipResult | null {
  return describeIndexedRelationship(relationshipIndex(tree), fromId, toId);
}

/** A sentence a person can read: "June is your second cousin — you share
 * Arthur Rowan and Évelyn Vale." */
export function relationshipSentence(result: RelationshipResult): string {
  if (result.relationship === "not connected in the records") {
    return `${result.from.displayName} and ${result.to.displayName} are not connected by any recorded relationship.`;
  }
  if (result.relationship === "the same person") return `${result.from.displayName} is the same person.`;
  // on a direct line the "shared ancestor" is one of the two people, which
  // reads as nonsense ("Haj Chorok is your great-grandfather. They share Haj Chorok.")
  const direct = result.sharedAncestors.some((person) => person.id === result.from.id || person.id === result.to.id);
  const shared = result.sharedAncestors.length && !direct
    ? ` They share ${result.sharedAncestors.map((person) => person.displayName).join(" and ")}.`
    : "";
  return `${result.to.displayName} is ${result.from.displayName}'s ${result.relationship}.${shared}`;
}

/** The two-word version for a card or a list row: "your father", "your
 * great-aunt", "your second cousin". Marriage links keep their bridge person
 * because "related by marriage" alone is the very ambiguity the tag exists
 * to remove. Null when the records hold no chain at all. */
export type KinshipVoice = "your" | "his" | "her" | "their";
export function shortKinship(result: RelationshipResult | null, voice: KinshipVoice = "your"): string | null {
  if (!result || result.relationship === "not connected in the records") return null;
  if (result.relationship === "the same person") return voice === "your" ? "you" : null;
  // "your related by marriage, through Farajollah" is not English; on a card
  // the bridge belongs after the word, not inside a possessive
  if (result.relationship.startsWith("related by marriage")) {
    const through = result.relationship.includes("through ") ? result.relationship.split("through ")[1] : null;
    return `${voice} relative by marriage${through ? `, via ${through}` : ""}`;
  }
  return `${voice} ${result.relationship}`;
}

/** the possessive to label others from one person's seat */
export const voiceFor = (person: Person | undefined, isViewer: boolean): KinshipVoice =>
  isViewer ? "your" : person?.gender === "male" ? "his" : person?.gender === "female" ? "her" : "their";

/** Every person's kinship to one viewer, computed once per tree so a canvas
 * of hundreds of cards can label each one without a search apiece. */
export function kinshipMap(tree: FamilyTree, meId: string | null | undefined, voice: KinshipVoice = "your", lang: Lang = "en"): Map<string, string> {
  const labels = new Map<string, string>();
  if (!meId || !tree.people.some((person) => person.id === meId)) return labels;
  const describe = createRelationshipDescriber(tree);
  for (const person of tree.people) {
    const label = lang === "en" ? shortKinship(describe(meId, person.id), voice) : kinshipLabel(describe(meId, person.id), lang, voice);
    if (label) labels.set(person.id, label);
  }
  return labels;
}
