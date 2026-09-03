"use client";
import { useEffect, useRef, useState } from "react";
import { FamilyTreeCanvas } from "../components/FamilyTreeCanvas";
import type { FamilyTree, Person } from "../../lib/types";
import { registerBrowserTools, type BrowserTool } from "../../lib/webmcp-register";
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
  const [message, setMessage] = useState("This sandbox uses invented people and resets in your browser. A browser agent (WebMCP) can build here too — its tools create, link, undo, and reset this very canvas.");
  const [undoDepth, setUndoDepth] = useState(0);
  /* Agent tool calls resolve before React commits, so state must never be
   * their source of truth: the ref is the synchronous authority for the
   * tree and its history, and React state mirrors it for rendering. */
  const live = useRef({ tree: BASE, history: [] as FamilyTree[] });
  const commit = (next: FamilyTree, note?: { keepHistory?: boolean }) => {
    if (!note?.keepHistory) live.current.history.push(live.current.tree);
    live.current.tree = next;
    setTree(next);
    setUndoDepth(live.current.history.length);
  };
  const undoLast = (): boolean => {
    const previous = live.current.history.pop();
    if (!previous) { setUndoDepth(0); return false; }
    live.current.tree = previous;
    setTree(previous); setSelected(null); setUndoDepth(live.current.history.length);
    return true;
  };
  function importFixture() { commit(IMPORTED); setMessage("Imported 4 people and 6 parent/spouse links from sample-family.ged. No conflicts found."); }
  function reset() { live.current = { tree: BASE, history: [] }; setTree(BASE); setSelected(null); setUndoDepth(0); setMessage("Sandbox reset. Nothing here touches the family archive."); }

  /* The sandbox is the WebMCP showcase: no sign-in, invented people, and a
   * browser agent gets full creative tools over the very canvas the human is
   * watching. Humans and agents build the same family together - the human
   * by clicking, the agent by calling - and either can undo the other. */
  useEffect(() => {
    const say = (text: string) => setMessage(`🤖 ${text}`);
    const findPerson = (name: unknown): Person => {
      const needle = String(name ?? "").trim().toLowerCase();
      const match = live.current.tree.people.filter((candidate) => candidate.displayName.toLowerCase() === needle);
      if (match.length !== 1) throw new Error(match.length ? `Several people are named ${name}.` : `Nobody named "${name}" is in the sandbox. list_family shows who is.`);
      return match[0];
    };
    const mutate = (next: (current: FamilyTree) => FamilyTree) => commit(next(live.current.tree));
    const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
    const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], run: (args: Record<string, unknown>) => string): BrowserTool => ({
      name, description,
      inputSchema: { type: "object", properties, additionalProperties: false, ...(required.length ? { required } : {}) },
      execute: async (args) => {
        try { const text = run(args ?? {}); say(text); return ok(text); }
        catch (error) { const text = error instanceof Error ? error.message : "That did not work."; return { ...ok(text), isError: true }; }
      },
    });

    const tools: BrowserTool[] = [
      tool("what_can_i_do_here", "What this sandbox offers. Call this when the user asks what they can do here or how it works - and consider calling it once when you first encounter this page, to introduce it. Returns a short introduction meant to be relayed.", {}, [],
        () => [
          "Introduce this sandbox to the user (your own voice is fine):",
          "This is TreeTree's sandbox - no sign-in, every person invented. You hold the same creative tools as the human:",
          '- "Add a person named Iris Rowan, born 1980"',
          '- "Make Maya Rowan her mother" / "Record her marriage to Owen Pike"',
          '- "Import the sample GEDCOM" (how a real archive ingests exports from other services)',
          '- "Undo that" - either of you can undo the other.',
          "The family grows on the canvas they are watching, and the sidebar narrates every move you make.",
        ].join("\n")),
      tool("list_family", "Everyone currently in the sandbox family, with birth years.", {}, [], () =>
        live.current.tree.people.map((person) => `${person.displayName} (${person.birthDate ?? "?"})`).join("; ") || "The sandbox is empty."),
      tool("add_person", "Add an invented person to the sandbox family the human is watching. The canvas updates immediately.",
        { name: { type: "string" }, birth_year: { type: "string" }, gender: { type: "string", enum: ["male", "female"] } }, ["name"],
        (args) => {
          const name = String(args.name ?? "").trim();
          if (!name) throw new Error("Give the person a name.");
          if (live.current.tree.people.some((person) => person.displayName.toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already here.`);
          const person = p(crypto.randomUUID(), name, String(args.birth_year ?? "").trim() || "", args.gender === "male" || args.gender === "female" ? args.gender : "female");
          mutate((current) => ({ ...current, people: [...current.people, person] }));
          setSelected(person);
          return `Added ${name} to the family.`;
        }),
      tool("link_parent", "Record that one sandbox person is a parent of another (both must exist; use their exact names).",
        { parent: { type: "string" }, child: { type: "string" } }, ["parent", "child"],
        (args) => {
          const parent = findPerson(args.parent), child = findPerson(args.child);
          if (parent.id === child.id) throw new Error("A person cannot be their own parent.");
          mutate((current) => ({ ...current, relationships: [...current.relationships, { id: crypto.randomUUID(), fromPersonId: parent.id, toPersonId: child.id, type: "parent" }] }));
          return `Linked ${parent.displayName} as a parent of ${child.displayName}.`;
        }),
      tool("link_marriage", "Record a marriage between two sandbox people (exact names).",
        { person_a: { type: "string" }, person_b: { type: "string" } }, ["person_a", "person_b"],
        (args) => {
          const a = findPerson(args.person_a), b = findPerson(args.person_b);
          mutate((current) => ({ ...current, relationships: [...current.relationships, { id: crypto.randomUUID(), fromPersonId: a.id, toPersonId: b.id, type: "spouse" }] }));
          return `Recorded the marriage of ${a.displayName} and ${b.displayName}.`;
        }),
      tool("import_sample_gedcom", "Run the canned GEDCOM import, the way a real archive ingests an export from another genealogy service.", {}, [],
        () => { commit(IMPORTED); return "Imported 4 people and 6 links from sample-family.ged."; }),
      tool("undo", "Undo the most recent change, whoever made it - human click or agent call.", {}, [],
        () => { if (!undoLast()) throw new Error("Nothing to undo."); return "Undone."; }),
      tool("reset_sandbox", "Clear the sandbox back to the founding couple.", {}, [],
        () => { reset(); return "Sandbox reset to Maya and Leo Rowan."; }),
    ];
    const run = async (name: string, args: Record<string, unknown>) => {
      const match = tools.find((candidate) => candidate.name === name);
      return match ? match.execute(args ?? {}) : { content: [{ type: "text" as const, text: `Unknown tool ${name}.` }], isError: true };
    };
    // the pre-hydration registrar's stubs wait for this dispatcher; when it
    // already owns the surface, registering again would duplicate the tools
    (window as unknown as { __ttDispatch?: typeof run }).__ttDispatch = run;
    const inline = (window as unknown as { __ttInlineRegistered?: boolean }).__ttInlineRegistered;
    const teardown = inline ? null : registerBrowserTools(tools);
    return () => {
      delete (window as unknown as { __ttDispatch?: typeof run }).__ttDispatch;
      teardown?.();
    };
  }, []);

  return <main className="demo-shell">
    <aside className="demo-sidebar">
      <Link className="settings-back-pill" href="/">← Back to the archive</Link><div><p className="eyebrow">Safe sample</p><h1>Meet the family archivist.</h1><p>Try the core loop with synthetic records: import a structured family file, inspect the graph, and undo it. In a WebMCP browser, your agent holds the same tools — ask it to build a family and watch this canvas.</p></div>
      <div className="settings-card"><strong>Archivist</strong><p data-demo-message>{message}</p></div>
      {selected && <div className="settings-card"><p className="eyebrow">Person</p><h2>{selected.displayName}</h2><p>Born {selected.birthDate || "—"}. This sample profile contains no real person or private source.</p></div>}
      <div className="demo-actions"><button type="button" onClick={importFixture} disabled={tree.people.length > BASE.people.length}>Import sample GEDCOM</button>{undoDepth > 0 && <button type="button" onClick={() => { if (undoLast()) setMessage("Undone in one step."); }}>Undo</button>}<button type="button" onClick={reset}>Reset</button></div>
    </aside>
    <section className="demo-canvas" aria-label="Synthetic family tree"><FamilyTreeCanvas tree={tree} onSelect={setSelected} highlightedIds={selected ? [selected.id] : []} focusPersonId={selected?.id} /></section>
  </main>;
}
