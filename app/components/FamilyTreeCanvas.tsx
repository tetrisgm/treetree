"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MutableRefObject } from "react";
import type { FamilyTree, Person } from "../../lib/types";
import { buildFamilyLayout } from "../../lib/tree-layout";
import { Silhouette } from "./TreePrimitives";

const cardDateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const noHighlightedIds: string[] = [];
function rememberHeldCard(ref: MutableRefObject<{ id: string; at: DOMRect } | null>, value: { id: string; at: DOMRect }) {
  ref.current = value;
}
function takeHeldCard(ref: MutableRefObject<{ id: string; at: DOMRect } | null>) {
  const value = ref.current;
  ref.current = null;
  return value;
}
function cardDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return cardDateFormat.format(new Date(Date.UTC(year, month - 1, day)));
}

export interface CanvasView { x: number; y: number; scale: number }

export function clampScale(scale: number) { return Math.max(0.5, Math.min(3, scale)); }
export function zoomView(view: CanvasView, factor: number, cursor: { x: number; y: number }) {
  const scale = clampScale(view.scale * factor);
  return { scale, x: cursor.x - (cursor.x - view.x) * (scale / view.scale), y: cursor.y - (cursor.y - view.y) * (scale / view.scale) };
}

export function panView(view: CanvasView, delta: { x: number; y: number }): CanvasView {
  return { ...view, x: view.x + delta.x, y: view.y + delta.y };
}

export function openCollapsedPath(
  collapsed: Set<string>,
  personId: string,
  primaryParent: Map<string, string>,
  primaryChildren: Map<string, string[]> = new Map(),
) {
  const next = new Set(collapsed);
  // A card represents a person's branch, not just one generation. Clear every
  // nested fold in that branch so one click cannot reveal only the next layer
  // and make the user click the same name repeatedly.
  const pending = [personId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    next.delete(current);
    pending.push(...(primaryChildren.get(current) ?? []));
  }
  let current: string | undefined = personId;
  let guard = 0;
  while (current && guard < 60) {
    next.delete(current);
    current = primaryParent.get(current);
    guard += 1;
  }
  return next;
}

export function toggleCollapsedBranch(collapsed: Set<string>, personId: string) {
  const next = new Set(collapsed);
  if (next.has(personId)) next.delete(personId);
  else next.add(personId);
  return next;
}

export function centerViewOn(
  view: CanvasView,
  worldPoint: { x: number; y: number },
  viewport: { width: number; height: number },
): CanvasView {
  return {
    ...view,
    x: viewport.width / 2 - worldPoint.x * view.scale,
    y: viewport.height / 2 - worldPoint.y * view.scale,
  };
}

type CanvasCursorMode = "grab" | "grabbing" | "pointer";

function CanvasCursor({ mode, cursorRef }: { mode: CanvasCursorMode; cursorRef: React.RefObject<HTMLSpanElement | null> }) {
  return <span ref={cursorRef} className="tree-custom-cursor" data-mode={mode} data-visible="false" aria-hidden="true">
    <svg viewBox="0 0 32 32" focusable="false">
      {mode === "pointer" ? <path d="M9.5 3.5a2 2 0 0 1 4 0v9.1l1.1-1.4a2.1 2.1 0 0 1 3.4 2.4l.6-.8a2.1 2.1 0 0 1 3.5 2.2l.4-.4a2 2 0 0 1 3.4 1.9l-1.4 7.2a6.5 6.5 0 0 1-6.4 5.3h-2.7a7 7 0 0 1-5.7-3L5.8 20a2.2 2.2 0 0 1 3.4-2.7l.3.3V3.5Z" /> : mode === "grabbing" ? <path d="M8.3 12.4a2.2 2.2 0 0 1 3.4-1.8 2.3 2.3 0 0 1 4.1-.9 2.3 2.3 0 0 1 4.2.7 2.2 2.2 0 0 1 3.8 1.5l1 6.1a8.5 8.5 0 0 1-8.4 9.9h-.8a8.5 8.5 0 0 1-8.3-6.8l-.9-4.4a2.2 2.2 0 0 1 1.9-4.3Z" /> : <path d="M7.8 13.8V8.1a2 2 0 0 1 4 0v4.1-6.4a2 2 0 0 1 4 0v6-7.1a2 2 0 0 1 4 0v7.6-5.1a2 2 0 0 1 4 0v10.4a10 10 0 0 1-10 10h-.4a8.4 8.4 0 0 1-7.7-5L3.9 18a2.2 2.2 0 0 1 3.9-2v-2.2Z" />}
    </svg>
  </span>;
}

type CanvasPosition = { x: number; y: number };
type SpouseLine = { id: string; path: string; status: string | null };
type ParentHook = {
  key: string;
  dropX: number;
  parentY: number;
  junctionY: number;
  barLeft: number;
  barRight: number;
  drops: CanvasPosition[];
  farLines: { path: string }[];
};

/** The graph scene is independent from the camera. React.memo keeps pointer,
 * wheel, and focus-animation camera commits from rebuilding every card and
 * connector; it rerenders only when graph/selection inputs actually change. */
const FamilyTreeScene = memo(function FamilyTreeScene({ visibleTree, positions, spouseLines, hooks, highlighted, branchIds, collapsed, hiddenCounts, onSelect, onOpenBranch, onToggleBranch }: {
  visibleTree: FamilyTree;
  positions: Map<string, CanvasPosition>;
  spouseLines: SpouseLine[];
  hooks: ParentHook[];
  highlighted: Set<string>;
  branchIds: string[];
  collapsed: Set<string>;
  hiddenCounts: Map<string, number>;
  onSelect: (person: Person) => void;
  onOpenBranch: (person: Person, at: DOMRect) => void;
  onToggleBranch: (personId: string) => void;
}) {
  return <>
    <svg className="tree-connectors">
      {spouseLines.map((line) => <path className={`spouse-connector${line.status ? " is-ended" : ""}`} key={line.id} d={line.path} fill="none" />)}
      {hooks.map((hook) => <g className="parent-connector" key={hook.key}>
        <line x1={hook.dropX} y1={hook.parentY} x2={hook.dropX} y2={hook.junctionY} />
        <line x1={hook.barLeft} y1={hook.junctionY} x2={hook.barRight} y2={hook.junctionY} />
        {hook.drops.map((drop) => <line key={`${drop.x}-${drop.y}`} x1={drop.x} y1={hook.junctionY} x2={drop.x} y2={drop.y} />)}
        {hook.farLines.map((farLine, index) => <path key={index} d={farLine.path} fill="none" />)}
      </g>)}
    </svg>
    {visibleTree.people.map((person) => {
      const p = positions.get(person.id) ?? { x: 0, y: 90 };
      const location = [person.birthCity, person.birthCountry].filter(Boolean).join(", ");
      const activate = (element: HTMLButtonElement) => {
        onOpenBranch(person, element.getBoundingClientRect());
        onSelect(person);
      };
      return <button className={`tree-card ${highlighted.has(person.id) ? "is-highlighted" : ""}`} style={{ left: `${p.x}px`, top: `${p.y}px`, cursor: "pointer" }} key={person.id} data-person-id={person.id} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => { event.stopPropagation(); if (event.button === 0) activate(event.currentTarget); }} onClick={(event) => { if (event.detail === 0) activate(event.currentTarget); }} aria-label={`Open ${person.displayName}`}><span className="tree-card-portrait">{person.photoAttachmentId ? <img src={`/api/photos/${person.photoAttachmentId}`} alt="" /> : <Silhouette gender={person.gender} />}</span><span className="tree-card-copy"><strong>{person.displayName}</strong><span>{person.birthDate ? `Born ${cardDate(person.birthDate)}` : "Birth date unknown"}{location ? ` · ${location}` : ""}</span></span></button>;
    })}
    {branchIds.map((id) => {
      const p = positions.get(id)!;
      const isFolded = collapsed.has(id);
      return <button key={`chip-${id}`} type="button" className="branch-chip" data-branch-person-id={id} style={{ left: `${p.x}px`, top: `${p.y + 56}px` }} aria-label={isFolded ? `Show ${hiddenCounts.get(id) ?? 0} hidden family members` : "Hide this branch"} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => { event.stopPropagation(); if (event.button === 0) onToggleBranch(id); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) onToggleBranch(id); }}>{isFolded ? `Show ${hiddenCounts.get(id) ?? 0} more` : "Hide branch"}</button>;
    })}
  </>;
});

export function FamilyTreeCanvas({ tree, onSelect, highlightedIds = noHighlightedIds, focusPersonId }: { tree: FamilyTree; onSelect: (person: Person) => void; highlightedIds?: string[]; focusPersonId?: string }) {
  // The canvas is heavy (hundreds of cards and connector segments); rendering
  // it during the server response repeatedly tripped the Worker CPU limit, so
  // the server sends a light shell and the tree appears on hydration.
  const ready = useSyncExternalStore(() => () => {}, () => true, () => false);
  // Branch folding: each parent card carries a chip; deep branches start
  // folded so the whole tree opens at a readable width.
  const fullLayout = useMemo(() => (ready ? buildFamilyLayout(tree) : null), [tree, ready]);
  const primaryChildren = useMemo(() => {
    const map = new Map<string, string[]>();
    if (fullLayout) for (const [child, parent] of fullLayout.primaryParent) {
      const children = map.get(parent);
      if (children) children.push(child);
      else map.set(parent, [child]);
    }
    return map;
  }, [fullLayout]);
  const defaultCollapsed = useMemo(() => {
    const set = new Set<string>();
    if (!fullLayout) return set;
    // Layout positions already carry generation depth as their y slot; avoid
    // running the graph's iterative generation pass a second time.
    for (const parent of primaryChildren.keys()) if ((fullLayout.positions.get(parent)?.y ?? 0) >= 4) set.add(parent);
    return set;
  }, [fullLayout, primaryChildren]);
  const [collapsedState, setCollapsedState] = useState<Set<string> | null>(null);
  const collapsed = collapsedState ?? defaultCollapsed;
  const collapsedRef = useRef(collapsed);
  useLayoutEffect(() => { collapsedRef.current = collapsed; }, [collapsed]);
  const holdInPlace = useRef<{ id: string; at: DOMRect } | null>(null);
  const openBranch = useCallback((person: Person, at: DOMRect) => {
    if (!fullLayout) return;
    // Always derive from React's latest stored value. Two quick clicks on
    // different names can arrive before a render refreshes this callback;
    // closing over `collapsed` made the second click replay stale state.
    setCollapsedState((stored) => {
      const current = stored ?? defaultCollapsed;
      const next = openCollapsedPath(current, person.id, fullLayout.primaryParent, primaryChildren);
      if (next.size === current.size) return stored;
      rememberHeldCard(holdInPlace, { id: person.id, at });
      return next;
    });
  }, [defaultCollapsed, fullLayout, primaryChildren]);
  const toggleBranch = useCallback((personId: string) => {
    setCollapsedState((stored) => toggleCollapsedBranch(stored ?? defaultCollapsed, personId));
  }, [defaultCollapsed]);
  const { visibleTree, hiddenCounts, visibleSet } = useMemo(() => {
    if (!fullLayout || collapsed.size === 0) {
      const counts = new Map<string, number>();
      return { visibleTree: tree, hiddenCounts: counts, visibleSet: new Set(tree.people.map((person) => person.id)) };
    }
    const parentless = new Set(tree.people.map((person) => person.id));
    for (const link of tree.relationships) if (link.type === "parent") parentless.delete(link.toPersonId);
    const spousesOf = new Map<string, string[]>();
    for (const link of tree.relationships) {
      if (link.type !== "spouse") continue;
      const fromPartners = spousesOf.get(link.fromPersonId);
      if (fromPartners) fromPartners.push(link.toPersonId);
      else spousesOf.set(link.fromPersonId, [link.toPersonId]);
      const toPartners = spousesOf.get(link.toPersonId);
      if (toPartners) toPartners.push(link.fromPersonId);
      else spousesOf.set(link.toPersonId, [link.fromPersonId]);
    }
    const hidden = new Set<string>();
    const hideDescendants = (id: string) => {
      for (const child of primaryChildren.get(id) ?? []) {
        if (hidden.has(child)) continue;
        hidden.add(child);
        hideDescendants(child);
      }
    };
    for (const id of collapsed) hideDescendants(id);
    for (const [id, partners] of spousesOf) {
      if (parentless.has(id) && partners.every((partner) => hidden.has(partner))) hidden.add(id);
    }
    const hiddenCounts = new Map<string, number>();
    const countBranch = (id: string): number => {
      const cached = hiddenCounts.get(id);
      if (cached !== undefined) return cached;
      let count = 0;
      for (const child of primaryChildren.get(id) ?? []) {
        count += 1 + countBranch(child);
        for (const spouse of spousesOf.get(child) ?? []) if (parentless.has(spouse)) count += 1;
      }
      hiddenCounts.set(id, count);
      return count;
    };
    for (const parent of primaryChildren.keys()) countBranch(parent);
    const visibleSet = new Set(tree.people.filter((person) => !hidden.has(person.id)).map((person) => person.id));
    const visibleTree: FamilyTree = hidden.size === 0 ? tree : {
      people: tree.people.filter((person) => visibleSet.has(person.id)),
      relationships: tree.relationships.filter((link) => visibleSet.has(link.fromPersonId) && visibleSet.has(link.toPersonId)),
      stories: tree.stories,
    };
    return { visibleTree, hiddenCounts, visibleSet };
  }, [tree, fullLayout, primaryChildren, collapsed]);
  // Every derived structure is computed only when its graph inputs change;
  // camera frames are applied directly to the viewport below.
  // The world is measured in fixed pixels (cards have a fixed width), so a
  // couple's gap, the dash pattern, and every bar length look the same on
  // every screen size; the viewport transform provides pan and zoom.
  const { positions, spouseLines, hooks } = useMemo(() => {
    if (!ready || !fullLayout) return { positions: new Map<string, CanvasPosition>(), spouseLines: [] as SpouseLine[], hooks: [] as ParentHook[] };
    const SLOT = 270, ROW = 190;
    const sceneTree = visibleTree;
    // With no folded branches visibleTree is the original tree, so reuse the
    // full layout instead of repeating its iterative graph walks.
    const layout = visibleTree === tree ? fullLayout : buildFamilyLayout(sceneTree);
    const positions = new Map<string, CanvasPosition>();
    for (const [id, slot] of layout.positions) positions.set(id, { x: (slot.x - layout.anchorX) * SLOT, y: 90 + slot.y * ROW });
    // marriages: a straight line between a couple sitting together, a raised
    // elbow between spouses drawn in different family blocks (cousin
    // marriages) so the line never runs through the cards between them
    const spouseLines = sceneTree.relationships
      .filter((link) => link.type === "spouse")
      .map((link) => {
        const a = positions.get(link.fromPersonId);
        const b = positions.get(link.toPersonId);
        if (!a || !b) return null;
        const adjacent = Math.abs(a.x - b.x) <= SLOT * 1.2 && a.y === b.y;
        const lift = Math.min(a.y, b.y) - 75;
        return { id: link.id, a, b, status: link.status ?? null, path: adjacent ? `M ${a.x} ${a.y} L ${b.x} ${b.y}` : `M ${a.x} ${a.y} L ${a.x} ${lift} L ${b.x} ${lift} L ${b.x} ${b.y}` };
      })
      .filter((line): line is NonNullable<typeof line> => Boolean(line));
    // parent hooks: the bar spans the children; the drop comes from the couple
    // standing over them, and a parent living in another family block joins
    // with their own elbow instead of one bar across the whole canvas
    const parentsOfChild = new Map<string, string[]>();
    for (const link of sceneTree.relationships) {
      if (link.type !== "parent") continue;
      const parents = parentsOfChild.get(link.toPersonId);
      if (parents) parents.push(link.fromPersonId);
      else parentsOfChild.set(link.toPersonId, [link.fromPersonId]);
    }
    const sets = new Map<string, { parentIds: string[]; children: string[] }>();
    for (const [childId, parentIds] of parentsOfChild) {
      const sorted = [...new Set(parentIds)].sort();
      const key = sorted.join("|");
      const entry = sets.get(key) ?? { parentIds: sorted, children: [] };
      entry.children.push(childId);
      sets.set(key, entry);
    }
    // One line per meaning: descent is a single blue T - a drop from the
    // couple's marriage line (or the lone recorded parent), a bar over the
    // children, and a stem to each child. A parent who lives in another
    // family block is connected by their amber marriage elbow alone.
    const hooks = [...sets.values()].flatMap(({ parentIds, children }) => {
      const allChildPoints = children.map((id) => positions.get(id)).filter(Boolean) as CanvasPosition[];
      const parentPoints = parentIds.map((id) => positions.get(id)).filter(Boolean) as CanvasPosition[];
      if (!allChildPoints.length || !parentPoints.length) return [];
      // a child drawn beside their spouse in another family block gets an
      // elbow of their own; the sibling bar spans only the home cluster
      const parentCenter = parentPoints.reduce((sum, p) => sum + p.x, 0) / parentPoints.length;
      const sorted = [...allChildPoints].sort((a, b) => a.x - b.x);
      let cluster = [sorted[0]];
      const clusters: CanvasPosition[][] = [cluster];
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].x - sorted[index - 1].x > SLOT * 3) { cluster = [sorted[index]]; clusters.push(cluster); }
        else cluster.push(sorted[index]);
      }
      const core = clusters.sort((a, b) => {
        const da = Math.min(...a.map((p) => Math.abs(p.x - parentCenter)));
        const db = Math.min(...b.map((p) => Math.abs(p.x - parentCenter)));
        return b.length - a.length || da - db;
      })[0];
      const farChildren = allChildPoints.filter((p) => !core.includes(p));
      let barLeft = Math.min(...core.map((p) => p.x));
      let barRight = Math.max(...core.map((p) => p.x));
      const junctionY = Math.min(...core.map((p) => p.y)) - ROW / 2;
      const center = (barLeft + barRight) / 2;
      const near = parentPoints.filter((p) => p.x >= barLeft - SLOT * 2 && p.x <= barRight + SLOT * 2);
      const anchors = near.length ? near : [parentPoints.sort((a, b) => Math.abs(a.x - center) - Math.abs(b.x - center))[0]];
      const dropX = anchors.reduce((sum, p) => sum + p.x, 0) / anchors.length;
      const parentY = Math.max(...anchors.map((p) => p.y));
      barLeft = Math.min(barLeft, dropX);
      barRight = Math.max(barRight, dropX);
      return [{
        key: parentIds.join("|"),
        dropX, parentY, junctionY, barLeft, barRight,
        drops: core.map((p) => ({ x: p.x, y: p.y })),
        farLines: farChildren.map((p) => ({
          path: `M ${Math.abs(p.x - barLeft) < Math.abs(p.x - barRight) ? barLeft : barRight} ${junctionY} L ${p.x} ${junctionY} L ${p.x} ${p.y}`,
        })),
      }];
    });
    return { positions, spouseLines, hooks };
  }, [visibleTree, tree, fullLayout, ready]);
  const highlighted = useMemo(() => new Set(highlightedIds), [highlightedIds]);
  const branchIds = useMemo(() => [...primaryChildren.keys()].filter((id) => visibleSet.has(id) && positions.has(id)), [primaryChildren, visibleSet, positions]);
  const [committedView, setCommittedView] = useState<CanvasView>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [cursorMode, setCursorMode] = useState<CanvasCursorMode>("grab");
  const gesture = useRef<{ x: number; y: number; view: CanvasView; moved: boolean } | null>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomLevelRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<CanvasView>(committedView);
  const cameraFrame = useRef(0);
  const cameraAnimation = useRef(0);
  const wheelCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelCameraAnimation = useCallback(() => {
    if (cameraAnimation.current) cancelAnimationFrame(cameraAnimation.current);
    cameraAnimation.current = 0;
  }, []);

  // Camera input is much more frequent than graph changes. Keep the current
  // camera in a ref, paint at most once per animation frame, and expose the
  // settled value to React only at gesture boundaries/control clicks.
  const paintView = useCallback((next: CanvasView) => {
    viewRef.current = next;
    if (cameraFrame.current) return;
    cameraFrame.current = requestAnimationFrame(() => {
      cameraFrame.current = 0;
      const current = viewRef.current;
      if (viewportRef.current) {
        viewportRef.current.style.transform = `translate(${current.x}px, ${current.y}px) scale(${current.scale})`;
        viewportRef.current.style.setProperty("--tree-scale", String(current.scale));
      }
      if (zoomLevelRef.current) {
        zoomLevelRef.current.textContent = `${Math.round(current.scale * 100)}%`;
      }
    });
  }, []);
  const commitView = useCallback((next = viewRef.current) => {
    paintView(next);
    setCommittedView((current) => current.x === next.x && current.y === next.y && current.scale === next.scale ? current : next);
  }, [paintView]);
  const cancelWheelCommit = useCallback(() => {
    if (wheelCommitTimer.current) clearTimeout(wheelCommitTimer.current);
    wheelCommitTimer.current = null;
  }, []);
  const zoomBy = (factor: number) => {
    cancelCameraAnimation();
    cancelWheelCommit();
    commitView(zoomView(viewRef.current, factor, { x: 0, y: 0 }));
  };
  const point = useCallback((person: Person) => positions.get(person.id) ?? { x: 0, y: 90 }, [positions]);
  const centerOn = useCallback((person: Person, animate = true) => {
    const rect = cursorRef.current?.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const p = point(person);
    const start = viewRef.current;
    const target = centerViewOn(start, p, rect);
    cancelCameraAnimation();
    cancelWheelCommit();
    if (!animate) { commitView({ ...start, ...target }); return; }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 360);
      const eased = 1 - (1 - progress) ** 3;
      const next = { ...start, x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased };
      paintView(next);
      if (progress < 1) cameraAnimation.current = requestAnimationFrame(tick);
      else { cameraAnimation.current = 0; commitView(next); }
    };
    cameraAnimation.current = requestAnimationFrame(tick);
  }, [cancelCameraAnimation, cancelWheelCommit, commitView, paintView, point]);
  // React can render for selection or cursor state while a wheel gesture is
  // still in flight. Reapply the authoritative ref after every commit so an
  // older inline style cannot briefly snap the camera backward.
  useLayoutEffect(() => {
    const current = viewRef.current;
    if (viewportRef.current) {
      viewportRef.current.style.transform = `translate(${current.x}px, ${current.y}px) scale(${current.scale})`;
      viewportRef.current.style.setProperty("--tree-scale", String(current.scale));
    }
    if (zoomLevelRef.current) zoomLevelRef.current.textContent = `${Math.round(current.scale * 100)}%`;
  });
  useEffect(() => () => {
    if (cameraFrame.current) cancelAnimationFrame(cameraFrame.current);
    cancelCameraAnimation();
    cancelWheelCommit();
  }, [cancelCameraAnimation, cancelWheelCommit]);
  // Choosing a person opens their branch - the same thing their chip does -
  // along with the line of ancestors that would otherwise keep them hidden.
  // This used to run only for someone already out of sight, so clicking a
  // card you could see left their own family folded away underneath them.
  useEffect(() => {
    if (!focusPersonId || !fullLayout) return;
    const frame = requestAnimationFrame(() => {
      const current = collapsedRef.current;
      const next = openCollapsedPath(current, focusPersonId, fullLayout.primaryParent, primaryChildren);
      if (next.size !== current.size) setCollapsedState(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusPersonId, fullLayout, primaryChildren]);
  const lastCentered = useRef<string | null>(null);
  const enteredView = useRef(false);
  /** The screen rectangle a card occupied when it was clicked, so opening its
   *  branch does not slide it out from under the pointer. Measured from the
   *  DOM rather than the layout model: `translate(x,y) scale(s)` puts the
   *  translation in screen pixels, so a screen delta is what the view wants. */
  useEffect(() => {
    const person = focusPersonId ? tree.people.find((candidate) => candidate.id === focusPersonId) : undefined;
    if (!person || !positions.has(person.id) || lastCentered.current === person.id) return;
    const first = !enteredView.current;
    enteredView.current = true;
    lastCentered.current = person.id;
    // Arriving in the Tree view should simply BE centred. After that the
    // camera only moves for someone who is not already on screen - reaching
    // them from the chat or the search. Clicking a card you can see should
    // leave the tree exactly where it is.
    if (first) { centerOn(person, false); return; }
    const rect = cursorRef.current?.parentElement?.getBoundingClientRect();
    if (rect) {
      const p = point(person);
      const currentView = viewRef.current;
      const screenX = currentView.x + p.x * currentView.scale, screenY = currentView.y + p.y * currentView.scale;
      const margin = 90;
      if (screenX > margin && screenX < rect.width - margin && screenY > margin && screenY < rect.height - margin) return;
    }
    centerOn(person, true);
  }, [focusPersonId, positions, tree.people, centerOn, point]);
  /* Opening a branch inserts cards, and a tidy layout slides its neighbours
     apart to make room. The card that was clicked should not be one of them:
     the view shifts by exactly what that card's own position changed. */
  useLayoutEffect(() => {
    const hold = takeHeldCard(holdInPlace);
    if (!hold) return;
    const card = cursorRef.current?.parentElement?.querySelector(`[data-person-id="${hold.id}"]`);
    if (!card) return;
    const now = card.getBoundingClientRect();
    const dx = hold.at.left - now.left, dy = hold.at.top - now.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) commitView(panView(viewRef.current, { x: dx, y: dy }));
  }, [positions, commitView]);
  // Open on the patriarch: world x 0 is the layout anchor. The canvas animates
  // open when the chat collapses beside it, so the frame waits for a width
  // that has stopped moving - measured mid-transition it once latched onto
  // 8.8px and left the whole tree off the edge of a phone, permanently.
  const centered = useRef(false);
  useLayoutEffect(() => {
    if (!ready || centered.current) return;
    let raf = 0;
    let last = -1;
    const attempt = () => {
      const width = cursorRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
      if (!width || width !== last) { last = width; raf = requestAnimationFrame(attempt); return; }
      centered.current = true;
      // a card is 15rem wide; on a narrow canvas open far enough out to see
      // more than one of them
      commitView({ x: width / 2, y: 30, scale: clampScale(Math.min(1, width / 640)) });
    };
    attempt();
    return () => cancelAnimationFrame(raf);
  }, [ready, commitView]);
  const positionCursor = (event: React.PointerEvent<HTMLDivElement>) => {
    const cursor = cursorRef.current;
    if (!cursor || event.pointerType === "touch") return;
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
    const target = event.target as Element;
    if (target.closest?.(".canvas-controls")) {
      cursor.dataset.visible = "false";
      return;
    }
    cursor.dataset.visible = "true";
    setCursorMode(gesture.current ? "grabbing" : target.closest?.(".tree-card, .branch-chip") ? "pointer" : "grab");
  };
  const hideCursor = () => {
    if (cursorRef.current && !gesture.current) cursorRef.current.dataset.visible = "false";
  };
  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    cancelCameraAnimation();
    cancelWheelCommit();
    gesture.current = { x: event.clientX, y: event.clientY, view: viewRef.current, moved: false };
    setIsPanning(true);
    setCursorMode("grabbing");
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    positionCursor(event);
    if (!gesture.current) return;
    const dx = event.clientX - gesture.current.x;
    const dy = event.clientY - gesture.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) gesture.current.moved = true;
    paintView(panView(gesture.current.view, { x: dx, y: dy }));
  };
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const activeGesture = gesture.current;
    gesture.current = null;
    if (activeGesture) commitView();
    setIsPanning(false);
    setCursorMode((event.target as Element).closest?.(".tree-card, .branch-chip") ? "pointer" : "grab");
  };
  // Two-finger trackpad scroll pans the camera; a pinch arrives as a wheel
  // event with ctrlKey (metaKey kept for keyboard-modified zoom) and zooms.
  const wheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    cancelCameraAnimation();
    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY > 0 ? .92 : 1.08;
      const rect = event.currentTarget.getBoundingClientRect();
      const cx = event.clientX - rect.left - rect.width / 2;
      const cy = event.clientY - rect.top - rect.height / 2;
      paintView(zoomView(viewRef.current, factor, { x: cx, y: cy }));
    } else {
      paintView(panView(viewRef.current, { x: -event.deltaX, y: -event.deltaY }));
    }
    cancelWheelCommit();
    wheelCommitTimer.current = setTimeout(() => { wheelCommitTimer.current = null; commitView(); }, 120);
  };
  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    cancelCameraAnimation();
    cancelWheelCommit();
    const current = viewRef.current;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      commitView(panView(current, { x: event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0, y: event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0 }));
    } else if (event.key === "+" || event.key === "=") commitView({ ...current, scale: Math.min(3, current.scale * 1.1) });
    else if (event.key === "-" || event.key === "_") commitView({ ...current, scale: Math.max(.5, current.scale * .9) });
    else if (event.key === "0") commitView({ x: 0, y: 0, scale: 1 });
  };
  if (!ready) {
    return <div className="family-canvas" role="application" aria-label="Interactive family tree" aria-busy="true" data-interactive="false">
      <div className="canvas-hit-surface" aria-hidden="true" />
    </div>;
  }
  return <div className="family-canvas" role="application" aria-label="Interactive family tree. Use arrow keys to pan, plus or minus to zoom, and 0 to reset." tabIndex={0} data-custom-cursor="true" data-interactive="true" data-panning={isPanning ? "true" : "false"} style={{ cursor: isPanning ? "grabbing" : "grab" }} onKeyDown={keyDown} onPointerEnter={positionCursor} onPointerLeave={hideCursor} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onWheel={wheel}>
    <div className="canvas-hit-surface" aria-hidden="true" style={{ cursor: isPanning ? "grabbing" : "grab" }} />
    <div className="canvas-legend" aria-hidden="true"><i className="legend-swatch legend-parent" /> parent <i className="legend-swatch legend-marriage" /> marriage</div>
    <div className="canvas-controls" role="group" aria-label="Canvas zoom controls">
      <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => zoomBy(0.9)} aria-label="Zoom out" title="Zoom out">−</button>
      <button ref={zoomLevelRef} type="button" className="canvas-zoom-level" onPointerDown={(event) => event.stopPropagation()} onClick={() => commitView({ x: 0, y: 0, scale: 1 })} aria-label="Reset zoom to 100 percent" title="Reset zoom">{Math.round(committedView.scale * 100)}%</button>
      <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => zoomBy(1.1)} aria-label="Zoom in" title="Zoom in">＋</button>
    </div>
    <div ref={viewportRef} className="tree-viewport" style={{ transform: `translate(${committedView.x}px, ${committedView.y}px) scale(${committedView.scale})`, "--tree-scale": String(committedView.scale) } as React.CSSProperties}>
      <FamilyTreeScene visibleTree={visibleTree} positions={positions} spouseLines={spouseLines} hooks={hooks} highlighted={highlighted} branchIds={branchIds} collapsed={collapsed} hiddenCounts={hiddenCounts} onSelect={onSelect} onOpenBranch={openBranch} onToggleBranch={toggleBranch} />
    </div>
    <CanvasCursor mode={cursorMode} cursorRef={cursorRef} />
  </div>;
}
