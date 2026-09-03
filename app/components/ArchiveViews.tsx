"use client";

import { useEffect, useRef, useState } from "react";
import { buildTimeline, mapFamilyPlaces, type MappedPlace } from "../../lib/archive-views";
import { buildFamilyStats } from "../../lib/family-stats";
import { onThisDay } from "../../lib/family-facts";
import { useLanguage } from "./LanguageContext";
import { WORLD_COUNTRY_PATHS } from "../../lib/world-map-paths";
import type { FamilyTree, Person } from "../../lib/types";

function prettyDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!month || !day) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function TimelineView({ tree, onSelect, meId }: { tree: FamilyTree; onSelect: (person: Person) => void; meId?: string | null }) {
  const { t } = useLanguage();
  const events = buildTimeline(tree);
  // a long list of strangers opens where the reader stands in it
  const scrollHere = useScrollIntoView(meId);
  return <section className="archive-view archive-timeline" aria-label="Family timeline">
    <div className="archive-view-heading"><p className="eyebrow">Timeline</p><h2>{t("timeline.title")}</h2><p>Births, deaths, and dated family stories appear here automatically.</p></div>
    {events.length ? <ol className="timeline-list">{events.map((event) => {
      const person = event.personIds.length === 1 ? tree.people.find((candidate) => candidate.id === event.personIds[0]) : undefined;
      const isMe = Boolean(meId && event.personIds.includes(meId));
      return <li key={event.id} className={isMe ? "is-me" : undefined} ref={isMe ? scrollHere : undefined}><time>{event.year}</time><span className={`timeline-dot is-${event.kind}`} /><button type="button" disabled={!person} onClick={() => person && onSelect(person)}><span>{event.title}</span><strong>{prettyDate(event.date)}{event.detail ? ` · ${event.detail}` : ""}</strong></button></li>;
    })}</ol> : <p className="archive-empty">Dates added to people and stories will build this timeline.</p>}
  </section>;
}

export function WorldMapView({ tree, onSelectPlace, onPreviewPlace }: { tree: FamilyTree; onSelectPlace: (place: MappedPlace) => void; onPreviewPlace?: (place: MappedPlace | null) => void }) {
  const { t } = useLanguage();
  const { mapped, unmapped } = mapFamilyPlaces(tree);
  // The board's own width, untransformed, so screen distances can be worked
  // out from the percentages the places are placed at.
  const [boardWidth, setBoardWidth] = useState(0);
  // The map pans and zooms with the same grammar as the Tree and Family
  // canvases: drag or wheel to pan, ctrl/cmd+wheel or the buttons to zoom.
  // Zoom bottoms out at 1 - the frame already shows the whole world.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const dragRef = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const framed = useRef(false);
  // the opening framing lands a frame after the places arrive, which can be
  // well after first paint on a slow load; the flag says when the map is done
  // moving on its own, so a pan measured against it is the reader's alone
  const [hasFramed, setHasFramed] = useState(false);
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => setBoardWidth(board.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  // a handful of places: cheap enough to plan every render, and the React
  // Compiler memoizes it for free
  const labelPlan = planLabels(mapped, scale, boardWidth);
  // Open on the family, not on the whole planet: frame the recorded places
  // (Paris to Darab, in this archive) with room to breathe.
  useEffect(() => {
    if (framed.current || !mapped.length) return;
    const frame = requestAnimationFrame(() => {
      const stage = stageRef.current, board = boardRef.current;
      if (!stage || !board) return;
      const stageBox = stage.getBoundingClientRect();
      const boardBox = board.getBoundingClientRect();
      if (!stageBox.width || !boardBox.width) return;
      framed.current = true;
      setHasFramed(true);
      const xs = mapped.map((place) => place.x / 100), ys = mapped.map((place) => place.y / 100);
      const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
      const midX = (Math.max(...xs) + Math.min(...xs)) / 2, midY = (Math.max(...ys) + Math.min(...ys)) / 2;
      // 2.2x padding keeps labels off the edges; never zoom past 4x
      const next = Math.max(1, Math.min(4,
        Math.min(stageBox.width / Math.max(boardBox.width * spanX * 2.2, 1), stageBox.height / Math.max(boardBox.height * spanY * 2.6, 1))));
      setScale(next);
      setPan({
        x: (boardBox.width * (0.5 - midX)) * next,
        y: (boardBox.height * (0.5 - midY)) * next,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [mapped]);
  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanning(true);
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
  };
  const endPan = () => { dragRef.current = null; setPanning(false); };
  // Zoom keeps the anchor point still: the cursor for wheel zoom, the stage
  // center for the buttons - so the place you are looking at never flies off.
  const zoomAt = (factor: number, anchor: { x: number; y: number }) => {
    const next = Math.max(1, Math.min(8, scale * factor));
    if (next === scale) return;
    const shift = (scale - next) / scale;
    setPan({ x: pan.x + shift * (anchor.x - pan.x), y: pan.y + shift * (anchor.y - pan.y) });
    setScale(next);
  };
  const wheelPan = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      zoomAt(event.deltaY > 0 ? 0.94 : 1.06, { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) });
    } else setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
  };
  // Full-bleed like the other canvases: the stage is the whole tab, and the
  // 2:1 board (which the marker percentages are calibrated to) covers it.
  return <section className="archive-view family-map-view" aria-label="Family places">
    <div className="world-map" ref={stageRef} role="img" aria-label="World map with recorded family locations" data-panning={panning ? "true" : "false"} data-framed={hasFramed ? "true" : "false"}
      onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onWheel={wheelPan}
      onDoubleClick={(event) => {
        // a map zooms in where you double-click, around the point you chose -
        // but a double-click on a city is about that city, not the ground
        // under it, and it already opens the place
        if ((event.target as HTMLElement).closest(".map-marker")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        zoomAt(1.6, { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) });
      }}>
      <div className="canvas-controls map-zoom" role="group" aria-label="Map zoom controls">
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => zoomAt(0.9, { x: 0, y: 0 })} aria-label={t("map.zoomOut")} title={t("map.zoomOut")}>−</button>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }} className="canvas-zoom-level" aria-label={t("map.reset")} title={t("map.reset")}>{Math.round(scale * 100)}%</button>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => zoomAt(1.1, { x: 0, y: 0 })} aria-label={t("map.zoomIn")} title={t("map.zoomIn")}>＋</button>
      </div>
      <div className="world-map-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, "--map-scale": String(scale) } as React.CSSProperties}>
      <div className="world-map-board" ref={boardRef}>
      <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {WORLD_COUNTRY_PATHS.map((d, index) => <path d={d} key={index} />)}
      </svg>
      {mapped.map((location) => <button type="button" className={`map-marker is-${labelPlan.get(location.key) ?? "right"}`} style={{ left: `${location.x}%`, top: `${location.y}%`, zIndex: 4 + location.people.length }} key={location.key} onClick={() => onSelectPlace(location)}
        onMouseEnter={() => onPreviewPlace?.(location)} onMouseLeave={() => onPreviewPlace?.(null)}
        onFocus={() => onPreviewPlace?.(location)} onBlur={() => onPreviewPlace?.(null)} aria-label={`${location.label}: ${location.people.map((person) => person.displayName).join(", ")}`}><span>{location.people.length}</span><strong>{location.label}</strong></button>)}
      {!mapped.length && <p className="map-empty">Add a birth or death city and country to place someone on the map.</p>}
      </div>
      </div>
    </div>
    {unmapped.length > 0 && <p className="unmapped-places">Recorded locations awaiting map coordinates: {unmapped.join(" · ")}</p>}
  </section>;
}


/** What the archive knows about itself: how complete it is, how long the
 * family has lived, where it has lived, and which names recur. Every number is
 * computed from the records as they stand. */
export function StatisticsView({ tree, onSelect }: { tree: FamilyTree; onSelect: (person: Person) => void }) {
  const { t } = useLanguage();
  const stats = buildFamilyStats(tree);
  const pct = (count: number) => stats.people ? Math.round((count / stats.people) * 100) : 0;
  const peak = Math.max(1, ...stats.births.map((entry) => entry.count));
  const bars = (rows: { label: string; count: number }[]) => {
    const most = Math.max(1, ...rows.map((row) => row.count));
    return <ul className="stat-bars">{rows.map((row) => <li key={row.label}>
      <span className="stat-bar-label">{row.label}</span>
      <span className="stat-bar-track"><span className="stat-bar-fill" style={{ width: `${(row.count / most) * 100}%` }} /></span>
      <span className="stat-bar-count">{row.count}</span>
    </li>)}</ul>;
  };
  return <section className="archive-view archive-stats" aria-label="Family statistics">
    <div className="archive-view-heading"><p className="eyebrow">Statistics</p><h2>{t("stats.title")}</h2><p>{t("stats.intro")}</p></div>
    <div className="stat-cards">
      <div className="stat-card"><strong>{stats.people}</strong><span>people recorded</span></div>
      <div className="stat-card"><strong>{stats.relationships.parent + stats.relationships.spouse}</strong><span>{stats.relationships.parent} parent links · {stats.relationships.spouse} marriages</span></div>
      <div className="stat-card"><strong>{stats.stories}</strong><span>family stories</span></div>
      <div className="stat-card"><strong>{stats.lifespans.median ?? "—"}</strong><span>median lifespan, from {stats.lifespans.count} completed lives</span></div>
      {stats.lifespans.longest && <div className="stat-card"><strong>{stats.lifespans.longest.years}</strong><span>the longest life recorded — {stats.lifespans.longest.name}</span></div>}
      <div className="stat-card"><strong>{stats.men} / {stats.women}</strong><span>men / women{stats.unrecordedGender ? ` · ${stats.unrecordedGender} unrecorded` : ""}</span></div>
    </div>
    <div className="stat-sections">
      <section><h3>How complete the records are</h3>
        {bars([
          { label: `Birth date (${pct(stats.withBirthDate)}%)`, count: stats.withBirthDate },
          { label: `Biography (${pct(stats.withBiography)}%)`, count: stats.withBiography },
          { label: `Photograph (${pct(stats.withPhoto)}%)`, count: stats.withPhoto },
        ])}
        <p className="stat-note">Out of {stats.people} people. The Fill-in tab lists what is missing, record by record.</p>
      </section>
      <section><h3>Generations</h3>{bars(stats.generations)}</section>
      {stats.births.length > 0 && <section><h3>Recorded births by decade</h3>
        <ul className="stat-decades">{stats.births.map((entry) => <li key={entry.decade}>
          <span className="stat-decade-bar" style={{ height: `${Math.max(6, (entry.count / peak) * 100)}%` }} title={`${entry.count} in the ${entry.decade}`} />
          <span className="stat-decade-label">{entry.decade.replace("0s", "0")}</span>
        </li>)}</ul>
        <p className="stat-note">Only {stats.withBirthDate} of {stats.people} records carry a birth date, so this is the shape of what is known, not of the family.</p>
      </section>}
      <section><h3>Places</h3>{bars(stats.places)}</section>
      <section><h3>Family names</h3>{bars(stats.surnames)}</section>
      <section><h3>Given names</h3>{bars(stats.givenNames)}</section>
      <section><h3>Largest families</h3>
        <ul className="stat-people">{stats.largestFamilies.map((entry) => {
          const person = tree.people.find((candidate) => candidate.displayName === entry.name);
          return <li key={entry.name}><button type="button" disabled={!person} onClick={() => person && onSelect(person)}>{entry.name}</button><span>{entry.children} children</span></li>;
        })}</ul>
      </section>
    </div>
  </section>;
}


/** Labels collide in SCREEN space, and markers hold their screen size as the
 * map zooms - so two cities that overlap at 1x are legible at 4x. The busier
 * place keeps the right side, a crowded neighbour flips to the left, and only
 * a label with nowhere to go steps back to its count until hovered. */
type LabelSide = "right" | "left" | "above" | "below" | "quiet";

/** Where each city's name can sit without landing on another one.
 *
 * A name that will not fit beside its pin is not hidden any more: it is tried
 * above and below first, because a second city a little way down the map has
 * room over its own head even when the space beside it is taken. Only a name
 * with nowhere at all to go steps back to its count until hovered. */
function planLabels(mapped: MappedPlace[], scale: number, boardWidth: number): Map<string, LabelSide> {
  if (!boardWidth) return new Map();
  const boardHeight = boardWidth / 2;
  // measured from the rendered labels: 30px tall, at most ~90px wide
  const LABEL = 132, DISC = 34, ROW = 34, STACK = 30;
  const placed: { y: number; from: number; to: number }[] = [];
  const sides: [string, LabelSide][] = [];
  const free = (y: number, from: number, to: number) => !placed.some((other) =>
    Math.abs(other.y - y) < ROW && from < other.to && to > other.from);
  for (const place of [...mapped].sort((a, b) => b.people.length - a.people.length)) {
    const x = (place.x / 100) * boardWidth * scale;
    const y = (place.y / 100) * boardHeight * scale;
    // beside the pin first, then over its head, then under its feet
    const options: [LabelSide, number, number, number][] = [
      ["right", y, x - DISC / 2, x + DISC / 2 + LABEL],
      ["left", y, x - DISC / 2 - LABEL, x + DISC / 2],
      ["above", y - STACK, x - LABEL / 2, x + LABEL / 2],
      ["below", y + STACK, x - LABEL / 2, x + LABEL / 2],
    ];
    const found = options.find(([, atY, from, to]) => free(atY, from, to));
    if (found) {
      const [side, atY, from, to] = found;
      sides.push([place.key, side]);
      placed.push({ y: atY, from, to });
      // the pin itself still occupies its own row wherever the name went
      if (side === "above" || side === "below") placed.push({ y, from: x - DISC / 2, to: x + DISC / 2 });
    } else {
      sides.push([place.key, "quiet"]);
      placed.push({ y, from: x - DISC / 2, to: x + DISC / 2 });
    }
  }
  return new Map(sides);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The family's year: birthdays of the living, remembrances of the dead, and
 * the anniversaries of dated stories - the days worth a message. */
/** Puts the reader's own row on screen when a long list first opens. Runs
 *  once per id: after that the list is theirs to scroll. */
function useScrollIntoView(id: string | null | undefined) {
  const done = useRef<string | null>(null);
  return (element: HTMLElement | null) => {
    if (!element || !id || done.current === id) return;
    done.current = id;
    requestAnimationFrame(() => element.scrollIntoView({ block: "center" }));
  };
}

export function CalendarView({ tree, onSelect }: { tree: FamilyTree; onSelect: (person: Person) => void }) {
  const { t } = useLanguage();
  const today = new Date();
  const dayOf = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value).slice(5) : null;
  const yearOf = (value: string | null) => Number(String(value ?? "").slice(0, 4)) || null;
  type Entry = { key: string; monthDay: string; label: string; detail: string; personId?: string; kind: "birthday" | "remembrance" | "story" };
  const entries: Entry[] = [];
  for (const person of tree.people) {
    const born = dayOf(person.birthDate);
    if (born) {
      const bornYear = yearOf(person.birthDate)!;
      const living = !person.deathDate && today.getFullYear() - bornYear <= 110;
      entries.push({
        key: `b-${person.id}`, monthDay: born, personId: person.id,
        kind: living ? "birthday" : "remembrance",
        label: person.displayName,
        detail: living ? `turns ${today.getFullYear() - bornYear}` : `born ${bornYear}`,
      });
    }
    const died = dayOf(person.deathDate);
    if (died) entries.push({ key: `d-${person.id}`, monthDay: died, personId: person.id, kind: "remembrance", label: person.displayName, detail: `died ${yearOf(person.deathDate)}` });
  }
  for (const story of tree.stories) {
    const day = dayOf(story.date);
    if (day) entries.push({ key: `s-${story.id}`, monthDay: day, kind: "story", label: story.title, detail: `${yearOf(story.date)}` });
  }
  entries.sort((a, b) => a.monthDay.localeCompare(b.monthDay) || a.label.localeCompare(b.label));
  const byMonth = new Map<string, Entry[]>();
  for (const entry of entries) byMonth.set(entry.monthDay.slice(0, 2), [...(byMonth.get(entry.monthDay.slice(0, 2)) ?? []), entry]);
  const todayStamp = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todays = onThisDay(tree, today);

  return <section className="archive-view archive-calendar" aria-label="Family calendar">
    <div className="archive-view-heading"><p className="eyebrow">Calendar</p><h2>{t("calendar.title")}</h2><p>{t("calendar.intro")}</p></div>
    {todays.length > 0 && <div className="calendar-today">
      <p className="eyebrow">{t("calendar.today")}</p>
      {todays.map((fact, index) => <p className="calendar-today-line" key={index}>{fact.text}</p>)}
    </div>}
    {entries.length ? <div className="calendar-months">
      {MONTHS.map((month, index) => {
        const key = String(index + 1).padStart(2, "0");
        const rows = byMonth.get(key) ?? [];
        if (!rows.length) return null;
        return <section className="calendar-month" key={month}>
          <h3>{month}</h3>
          <ul>{rows.map((entry) => {
            const person = entry.personId ? tree.people.find((candidate) => candidate.id === entry.personId) : undefined;
            return <li className={entry.monthDay === todayStamp ? "is-today" : ""} key={entry.key}>
              <span className="calendar-day">{Number(entry.monthDay.slice(3))}</span>
              <span className={`calendar-dot is-${entry.kind}`} aria-hidden="true" />
              <button type="button" disabled={!person} onClick={() => person && onSelect(person)}>{entry.label}</button>
              <span className="calendar-detail">{entry.detail}</span>
            </li>;
          })}</ul>
        </section>;
      })}
    </div> : <p className="archive-empty">Full birth or death dates will fill this calendar. Most records carry only a year so far.</p>}
  </section>;
}
