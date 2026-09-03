"use client";

import { useMemo, useState } from "react";
import type { FamilyTree, Person } from "../../lib/types";
import { buildRelationMaps } from "../../lib/tree-layout";

/** "Which one of these is you?"
 *
 * Names repeat down a family - there are twelve Mohammads here - and a
 * grandson can carry his great-grandfather's name exactly. So every
 * suggestion says when the person was born and who their parents were, which
 * is what actually tells two people of the same name apart. */
export default function IdentifyMe({ tree, onClaimed }: { tree: FamilyTree; onClaimed: (person: Person) => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const maps = useMemo(() => buildRelationMaps(tree), [tree]);

  const describe = (person: Person) => {
    const born = person.birthDate?.slice(0, 4);
    const parents = (maps.parentsOf.get(person.id) ?? [])
      .map((id) => maps.byId.get(id)?.displayName).filter(Boolean);
    return [born ? `b. ${born}` : "birth year unknown", parents.length ? `child of ${parents.join(" and ")}` : "no recorded parents"].join(" · ");
  };

  const needle = query.trim().toLocaleLowerCase();
  const matches = needle.length < 2 ? [] : tree.people
    .filter((person) => person.displayName.toLocaleLowerCase().includes(needle))
    .slice(0, 8);

  async function claim(person: Person) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/me", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId: person.id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setError(data.error === "already_claimed"
          ? "Someone has already said they are this person. Ask a family admin if that looks wrong."
          : "That could not be saved. Please try again.");
        return;
      }
      onClaimed(person);
    } catch {
      setError("That could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (dismissed) return null;
  return (
    <div className="identify-card">
      <div className="identify-head">
        <p className="eyebrow">Who are you in the tree?</p>
        <button type="button" className="identify-skip" onClick={() => setDismissed(true)} aria-label="Not now">×</button>
      </div>
      <p>Type your name. Once the archive knows where you stand, it opens on you rather than on the founders.</p>
      <input
        className="modal-input" value={query} autoComplete="off" placeholder="Your name"
        aria-label="Your name in the family tree"
        onChange={(event) => { setQuery(event.target.value); setError(""); }}
      />
      {needle.length >= 2 && !matches.length && <p className="identify-none">No one of that name is recorded yet. A family editor can add you.</p>}
      {matches.length > 0 && <ul className="identify-matches">
        {matches.map((person) => <li key={person.id}>
          <button type="button" disabled={busy} onClick={() => claim(person)}>
            <strong>{person.displayName}</strong>
            <span>{describe(person)}</span>
          </button>
        </li>)}
      </ul>}
      {error && <p className="identify-error" role="alert">{error}</p>}
    </div>
  );
}
