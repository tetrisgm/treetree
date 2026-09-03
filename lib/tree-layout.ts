import type { FamilyTree, Person } from "./types";

function appendMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

/** Put parent edges in ancestor-first order when the recorded graph is a DAG.
 * Relaxation then reaches the same fixed point in one pass regardless of SQL
 * row order. Malformed cycles deliberately keep their original bounded-pass
 * behavior and are reported separately by the data-integrity checks. */
function orderParentEdges<T extends { fromPersonId: string; toPersonId: string }>(people: Person[], links: T[]): T[] {
  if (links.length < 2) return links;
  const ids = new Set(people.map((person) => person.id));
  if (links.some((link) => !ids.has(link.fromPersonId) || !ids.has(link.toPersonId))) return links;
  const indegree = new Map(people.map((person) => [person.id, 0]));
  const outgoing = new Map<string, T[]>();
  for (const link of links) {
    indegree.set(link.toPersonId, (indegree.get(link.toPersonId) ?? 0) + 1);
    appendMapValue(outgoing, link.fromPersonId, link);
  }
  const queue = people.filter((person) => indegree.get(person.id) === 0).map((person) => person.id);
  const ordered: T[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    for (const link of outgoing.get(queue[index]) ?? []) {
      ordered.push(link);
      const remaining = (indegree.get(link.toPersonId) ?? 1) - 1;
      indegree.set(link.toPersonId, remaining);
      if (remaining === 0) queue.push(link.toPersonId);
    }
  }
  return ordered.length === links.length ? ordered : links;
}

export function buildGenerations(tree: FamilyTree) {
  const depth = new Map(tree.people.map((person) => [person.id, 0]));
  const parentLinks = orderParentEdges(tree.people, tree.relationships.filter((item) => item.type === "parent"));
  const spouseLinks = tree.relationships.filter((item) => item.type === "spouse");
  const hasParent = new Set(parentLinks.map((item) => item.toPersonId));
  const childrenOfRootless = new Map<string, string[]>();
  for (const link of parentLinks) {
    if (!hasParent.has(link.fromPersonId)) {
      appendMapValue(childrenOfRootless, link.fromPersonId, link.toPersonId);
    }
  }
  for (let pass = 0; pass < tree.people.length; pass += 1) {
    let changed = false;
    for (const link of parentLinks) {
      const current = depth.get(link.toPersonId) ?? 0;
      const next = Math.max(current, (depth.get(link.fromPersonId) ?? 0) + 1);
      if (next !== current) { depth.set(link.toPersonId, next); changed = true; }
    }
    // Spouses share a row: the shallower partner moves down to the deeper
    // one (a married-in spouse leaves the top row, and a bride with a
    // recorded father still stands on her husband's row).
    for (const link of spouseLinks) {
      const a = link.fromPersonId, b = link.toPersonId;
      const shared = Math.max(depth.get(a) ?? 0, depth.get(b) ?? 0);
      if ((depth.get(a) ?? 0) !== shared) { depth.set(a, shared); changed = true; }
      if ((depth.get(b) ?? 0) !== shared) { depth.set(b, shared); changed = true; }
    }
    // An in-law parent with no recorded ancestry (a bride's father named in
    // the biography) sits one row above their shallowest child.
    for (const [parent, children] of childrenOfRootless) {
      const shallowest = Math.min(...children.map((child) => depth.get(child) ?? 0));
      const current = depth.get(parent) ?? 0;
      const next = Math.max(current, shallowest - 1);
      if (next !== current) { depth.set(parent, next); changed = true; }
    }
    if (!changed) break;
  }
  const groups = new Map<number, Person[]>();
  tree.people.forEach((person) => {
    const level = depth.get(person.id) ?? 0;
    appendMapValue(groups, level, person);
  });
  return { depth, groups };
}

export interface FamilyLayout {
  positions: Map<string, { x: number; y: number }>;
  /** total width in slot units */
  width: number;
  /** x slot of the first root (the patriarch) - the natural opening view */
  anchorX: number;
  /** child id -> the parent under whose family block the child is drawn */
  primaryParent: Map<string, string>;
}

/**
 * Classic genealogy layout: a couple sits side by side, their children hang
 * directly beneath them, and each sibling brings their own family block along.
 *
 * - A spouse with no recorded parents joins their partner's couple row (a
 *   person with two marriages sits between the two spouses).
 * - When both parents grew up in the tree (a cousin marriage), the children
 *   are drawn once, under the parent closest to the root; the other parent
 *   keeps their own place and the marriage line spans the distance.
 * - x is measured in "slots" (one card wide); y is the generation row.
 */
export function buildFamilyLayout(tree: FamilyTree): FamilyLayout {
  const { depth } = buildGenerations(tree);
  // ancestry depth over parent edges only (no spouse alignment): how far a
  // person's recorded ancestor chain reaches up
  const lineage = new Map(tree.people.map((person) => [person.id, 0]));
  const parentEdges = orderParentEdges(tree.people, tree.relationships.filter((item) => item.type === "parent"));
  for (let pass = 0; pass < tree.people.length; pass += 1) {
    let changed = false;
    for (const link of parentEdges) {
      const current = lineage.get(link.toPersonId) ?? 0;
      const next = Math.max(current, (lineage.get(link.fromPersonId) ?? 0) + 1);
      if (next !== current) { lineage.set(link.toPersonId, next); changed = true; }
    }
    if (!changed) break;
  }
  const byId = new Map(tree.people.map((person) => [person.id, person]));
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  for (const link of tree.relationships) {
    if (link.type === "parent") {
      appendMapValue(parentsOf, link.toPersonId, link.fromPersonId);
      appendMapValue(childrenOf, link.fromPersonId, link.toPersonId);
    } else {
      appendMapValue(spousesOf, link.fromPersonId, link.toPersonId);
      appendMapValue(spousesOf, link.toPersonId, link.fromPersonId);
    }
  }
  // two people who share a child stand together even without a recorded
  // marriage (layout only - no marriage line is drawn for them)
  for (const parents of parentsOf.values()) {
    if (parents.length !== 2) continue;
    const [a, b] = parents;
    if (!(spousesOf.get(a) ?? []).includes(b)) {
      appendMapValue(spousesOf, a, b);
      appendMapValue(spousesOf, b, a);
    }
  }
  const hasParents = (id: string) => (parentsOf.get(id)?.length ?? 0) > 0;
  const name = (id: string) => byId.get(id)?.displayName ?? "";

  // each child is drawn under exactly one parent: the one whose own ancestor
  // chain reaches deepest into the tree (so a family stays in the main line
  // rather than migrating under a bride's newly recorded father)
  const ancestorCount = new Map<string, number>();
  const countAncestors = (id: string): number => {
    const cached = ancestorCount.get(id);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const current = stack.pop()!;
      for (const parent of parentsOf.get(current) ?? []) {
        if (!seen.has(parent)) {
          seen.add(parent);
          stack.push(parent);
        }
      }
    }
    ancestorCount.set(id, seen.size);
    return seen.size;
  };
  const primaryParent = new Map<string, string>();
  for (const [child, parents] of parentsOf) {
    const pool = parents.filter(hasParents);
    const candidates = pool.length ? pool : parents;
    const best = [...candidates].sort(
      (a, b) =>
        (lineage.get(b) ?? 0) - (lineage.get(a) ?? 0) ||
        countAncestors(b) - countAncestors(a) ||
        (depth.get(a) ?? 0) - (depth.get(b) ?? 0) ||
        name(a).localeCompare(name(b)),
    )[0];
    primaryParent.set(child, best);
  }

  // Married people always stand together: for every couple the partner with
  // the shallower recorded ancestry leaves their own family block and joins
  // the deeper partner's row (their tie back to their parents is drawn as a
  // descent elbow instead).
  const anchorScore = (id: string) => [lineage.get(id) ?? 0, countAncestors(id)] as const;
  const outranks = (a: string, b: string) => {
    const [la, ca] = anchorScore(a);
    const [lb, cb] = anchorScore(b);
    if (la !== lb) return la > lb;
    if (ca !== cb) return ca > cb;
    if ((depth.get(a) ?? 0) !== (depth.get(b) ?? 0)) return (depth.get(a) ?? 0) < (depth.get(b) ?? 0);
    const byName = name(a).localeCompare(name(b));
    if (byName !== 0) return byName < 0;
    return a < b;
  };
  const attachedTo = new Map<string, string>();
  const pairs: [string, string][] = [];
  for (const [id, partners] of spousesOf) for (const partner of partners) if (id < partner) pairs.push([id, partner]);
  // strongest partners claim their spouses first so chains stay short
  pairs.sort((left, right) => (outranks(left[0], left[1]) ? 0 : 1) - (outranks(right[0], right[1]) ? 0 : 1));
  for (const [a, b] of pairs) {
    const winner = outranks(a, b) ? a : b;
    const loser = winner === a ? b : a;
    if (!attachedTo.has(loser) && loser !== winner) attachedTo.set(loser, winner);
  }
  // never attach to someone who is themselves attached into a cycle
  for (const [loser] of attachedTo) {
    const seen = new Set<string>([loser]);
    let current = attachedTo.get(loser);
    while (current !== undefined) {
      if (seen.has(current)) { attachedTo.delete(loser); break; }
      seen.add(current);
      current = attachedTo.get(current);
    }
  }
  const attachRoot = (id: string) => {
    let current = id;
    let guard = 0;
    while (attachedTo.has(current) && guard < 20) { current = attachedTo.get(current)!; guard += 1; }
    return current;
  };

  const attachedOf = new Map<string, string[]>();
  for (const [loser] of attachedTo) {
    const owner = attachRoot(loser);
    appendMapValue(attachedOf, owner, loser);
  }
  const memberRows = new Map<string, string[]>();
  const memberRow = (owner: string) => {
    const cached = memberRows.get(owner);
    if (cached) return cached;
    const attached = [...(attachedOf.get(owner) ?? [])];
    attached.sort((a, b) => name(a).localeCompare(name(b)));
    const members = attached.length <= 1
      ? [owner, ...attached]
      : [attached[0], owner, ...attached.slice(1)]; // sit between two spouses
    memberRows.set(owner, members);
    return members;
  };
  const childLists = new Map<string, string[]>();
  const childList = (owner: string) => {
    const cached = childLists.get(owner);
    if (cached) return cached;
    const members = memberRow(owner);
    const memberIds = new Set(members);
    const ids = new Set<string>();
    for (const member of members) {
      for (const child of childrenOf.get(member) ?? []) {
        if (memberIds.has(primaryParent.get(child) ?? "")) ids.add(child);
      }
    }
    const children = [...ids]
      .filter((child) => !attachedTo.has(child)) // drawn beside their spouse instead
      .sort((a, b) => {
        const ya = Number(byId.get(a)?.birthDate?.slice(0, 4)) || 9999;
        const yb = Number(byId.get(b)?.birthDate?.slice(0, 4)) || 9999;
        return ya - yb || name(a).localeCompare(name(b));
      });
    childLists.set(owner, children);
    return children;
  };

  const widths = new Map<string, number>();
  const measure = (owner: string): number => {
    if (widths.has(owner)) return widths.get(owner)!;
    widths.set(owner, memberRow(owner).length); // guard against cycles
    const kids = childList(owner);
    const childrenWidth = kids.reduce((sum, child) => sum + measure(child), 0);
    const width = Math.max(memberRow(owner).length, childrenWidth);
    widths.set(owner, width);
    return width;
  };

  const positions = new Map<string, { x: number; y: number }>();
  const place = (owner: string, left: number) => {
    if (positions.has(owner)) return;
    const width = measure(owner);
    const members = memberRow(owner);
    const row = depth.get(owner) ?? 0;
    const start = left + width / 2 - members.length / 2;
    members.forEach((member, index) => {
      if (!positions.has(member)) positions.set(member, { x: start + index + 0.5, y: depth.get(member) === row ? row : depth.get(member) ?? row });
    });
    let cursor = left + Math.max(0, (width - childList(owner).reduce((sum, child) => sum + measure(child), 0)) / 2);
    for (const child of childList(owner)) {
      place(child, cursor);
      cursor += measure(child);
    }
  };

  // roots: no parents and not drawn inside someone else's couple row. An
  // in-law parent whose every child is drawn beside a spouse elsewhere is a
  // "satellite": placed directly above that child rather than at the edge.
  const roots = tree.people
    .filter((person) => !hasParents(person.id) && !attachedTo.has(person.id))
    .sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || ((spousesOf.get(b.id)?.length ?? 0) - (spousesOf.get(a.id)?.length ?? 0)) || a.displayName.localeCompare(b.displayName));
  const isSatellite = (id: string) => childList(id).length === 0 && (childrenOf.get(id) ?? []).length > 0;
  let cursor = 0;
  let anchorX: number | null = null;
  for (const root of roots) {
    if (positions.has(root.id) || isSatellite(root.id)) continue;
    place(root.id, cursor);
    if (anchorX === null) anchorX = positions.get(root.id)?.x ?? null;
    cursor += measure(root.id) + 1;
  }
  for (const root of roots) {
    if (positions.has(root.id) || !isSatellite(root.id)) continue;
    const width = measure(root.id);
    const row = depth.get(root.id) ?? 0;
    const child = (childrenOf.get(root.id) ?? []).map((id) => positions.get(id)).find(Boolean);
    if (!child) { place(root.id, cursor); cursor += width + 1; continue; }
    const occupied = [...positions.values()].filter((slot) => slot.y === row).map((slot) => slot.x);
    const free = (center: number) => occupied.every((x) => Math.abs(x - center) > width / 2 + 0.6);
    let center = child.x;
    for (let step = 0; step < 40 && !free(center); step += 1) {
      const offset = (Math.floor(step / 2) + 1) * 1.1;
      center = child.x + (step % 2 === 0 ? offset : -offset);
    }
    place(root.id, center - width / 2);
  }
  // safety net: anything unplaced (odd data shapes) lines up at the end
  for (const person of tree.people) {
    if (!positions.has(person.id)) {
      positions.set(person.id, { x: cursor + 0.5, y: depth.get(person.id) ?? 0 });
      cursor += 1.5;
    }
  }
  return { positions, width: Math.max(cursor, 1), anchorX: anchorX ?? Math.max(cursor, 1) / 2, primaryParent };
}

export interface RelationMaps {
  parentsOf: Map<string, string[]>;
  childrenOf: Map<string, string[]>;
  spousesOf: Map<string, string[]>;
  /** sorted "idA|idB" -> spouse-link status (null while married) */
  spouseStatus: Map<string, string | null>;
  byId: Map<string, Person>;
}

/** Plain lookup maps over the recorded relationships, shared by the views. */
export function buildRelationMaps(tree: FamilyTree): RelationMaps {
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();
  const spouseStatus = new Map<string, string | null>();
  for (const link of tree.relationships) {
    if (link.type === "parent") {
      appendMapValue(parentsOf, link.toPersonId, link.fromPersonId);
      appendMapValue(childrenOf, link.fromPersonId, link.toPersonId);
    } else {
      appendMapValue(spousesOf, link.fromPersonId, link.toPersonId);
      appendMapValue(spousesOf, link.toPersonId, link.fromPersonId);
      spouseStatus.set([link.fromPersonId, link.toPersonId].sort().join("|"), link.status ?? null);
    }
  }
  return { parentsOf, childrenOf, spousesOf, spouseStatus, byId: new Map(tree.people.map((person) => [person.id, person])) };
}

/** Everyone this person would bring into view who is not already on the board.
 *  A sibling with a family of their own otherwise looks like a leaf: the count
 *  is the card's answer to "am I seeing the whole picture?". */
export function hiddenRelativeCount(personId: string, maps: RelationMaps, visible: Set<string>): number {
  const behind = new Set<string>();
  const consider = (id: string) => { if (id !== personId && !visible.has(id)) behind.add(id); };
  for (const id of maps.parentsOf.get(personId) ?? []) consider(id);
  for (const id of maps.childrenOf.get(personId) ?? []) consider(id);
  for (const id of maps.spousesOf.get(personId) ?? []) consider(id);
  // siblings arrive through the parents, and are the usual surprise
  for (const parentId of maps.parentsOf.get(personId) ?? []) {
    for (const id of maps.childrenOf.get(parentId) ?? []) consider(id);
  }
  return behind.size;
}
