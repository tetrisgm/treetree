"use client";

import { useMemo, useRef, useState } from "react";
import type { FamilyTree, Person } from "../../lib/types";
import { useLanguage } from "./LanguageContext";

export function personYears(person: Person | undefined) {
  if (!person) return "";
  const born = person.birthDate?.slice(0, 4);
  const died = person.deathDate?.slice(0, 4);
  if (born && died) return `${born}–${died}`;
  if (born) return `b. ${born}`;
  if (died) return `d. ${died}`;
  return "";
}

export function Silhouette({ gender }: { gender: Person["gender"] }) {
  return <span className={`ped-portrait ped-${gender ?? "unknown"}`} aria-hidden="true">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
  </span>;
}

/** Type-ahead person search stays in the initial shell; the much larger tree
 * view implementations are loaded only after the reader chooses one. */
export function TreeSearch({ tree, onPick }: { tree: FamilyTree; onPick: (person: Person) => void }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return tree.people
      .filter((person) => person.displayName.toLocaleLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.displayName.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
        const bStarts = b.displayName.toLocaleLowerCase().startsWith(needle) ? 0 : 1;
        return aStarts - bStarts || a.displayName.localeCompare(b.displayName);
      })
      .slice(0, 8);
  }, [tree, query]);
  const pick = (person: Person) => {
    setQuery("");
    setOpen(false);
    onPick(person);
  };
  return <div className="tree-search" ref={boxRef}>
    <input
      type="search"
      placeholder={t("nav.search")}
      value={query}
      autoComplete="off"
      aria-label={t("nav.search")}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onBlur={() => setTimeout(() => setOpen(false), 150)}
      onKeyDown={(event) => { if (event.key === "Enter" && matches[0]) pick(matches[0]); if (event.key === "Escape") { setQuery(""); setOpen(false); } }}
    />
    {open && matches.length > 0 && <div className="tree-search-results">
      {matches.map((person) => <button type="button" key={person.id} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(person)}>
        <strong>{person.displayName}</strong><span>{personYears(person) || "dates unknown"}</span>
      </button>)}
    </div>}
  </div>;
}
