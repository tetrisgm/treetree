"use client";
import { useState } from "react";
import { FamilyTreeCanvas } from "../components/FamilyTreeCanvas";
import type { FamilyTree, Person } from "../../lib/types";
import Link from "next/link";

const p = (id: string, displayName: string, birthDate: string, gender: "male" | "female"): Person => ({ id, displayName, gender, givenName: displayName.split(" ")[0], familyName: displayName.split(" ").slice(1).join(" "), maidenName: null, birthDate, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null, birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null, biography: null, photoAttachmentId: null });
const BASE: FamilyTree = { people: [p("maya", "Maya Rowan", "1952", "female"), p("leo", "Leo Rowan", "1950", "male")], relationships: [{ id: "couple", fromPersonId: "maya", toPersonId: "leo", type: "spouse" }], stories: [] };
const IMPORTED: FamilyTree = { people: [...BASE.people, p("nora", "Nora Rowan", "1978", "female"), p("sam", "Sam Ortiz", "1977", "male"), p("eli", "Eli Ortiz", "2008", "male"), p("june", "June Ortiz", "2011", "female")], relationships: [...BASE.relationships,
  { id: "r1", fromPersonId: "maya", toPersonId: "nora", type: "parent" }, { id: "r2", fromPersonId: "leo", toPersonId: "nora", type: "parent" },
  { id: "r3", fromPersonId: "nora", toPersonId: "sam", type: "spouse" }, { id: "r4", fromPersonId: "nora", toPersonId: "eli", type: "parent" },
  { id: "r5", fromPersonId: "sam", toPersonId: "eli", type: "parent" }, { id: "r6", fromPersonId: "nora", toPersonId: "june", type: "parent" },
  { id: "r7", fromPersonId: "sam", toPersonId: "june", type: "parent" }], stories: [] };

export default function DemoClient() {
  const [tree, setTree] = useState(BASE); const [selected, setSelected] = useState<Person | null>(null);
  const [message, setMessage] = useState("This sandbox uses invented people and resets in your browser.");
  const [undo, setUndo] = useState<FamilyTree | null>(null);
  function importFixture() { setUndo(tree); setTree(IMPORTED); setMessage("Imported 4 people and 6 parent/spouse links from sample-family.ged. No conflicts found."); }
  function reset() { setTree(BASE); setSelected(null); setUndo(null); setMessage("Sandbox reset. Nothing here touches the family archive."); }
  return <main className="demo-shell">
    <aside className="demo-sidebar">
      <Link className="settings-back-pill" href="/">← Back to the archive</Link><div><p className="eyebrow">Safe sample</p><h1>Meet the family archivist.</h1><p>Try the core loop with synthetic records: import a structured family file, inspect the graph, and undo it.</p></div>
      <div className="settings-card"><strong>Archivist</strong><p>{message}</p></div>
      {selected && <div className="settings-card"><p className="eyebrow">Person</p><h2>{selected.displayName}</h2><p>Born {selected.birthDate}. This sample profile contains no real person or private source.</p></div>}
      <div className="demo-actions"><button type="button" onClick={importFixture} disabled={tree.people.length > BASE.people.length}>Import sample GEDCOM</button>{undo && <button type="button" onClick={() => { setTree(undo); setUndo(null); setSelected(null); setMessage("Import undone in one step."); }}>Undo</button>}<button type="button" onClick={reset}>Reset</button></div>
    </aside>
    <section className="demo-canvas" aria-label="Synthetic family tree"><FamilyTreeCanvas tree={tree} onSelect={setSelected} highlightedIds={selected ? [selected.id] : []} focusPersonId={selected?.id} /></section>
  </main>;
}
