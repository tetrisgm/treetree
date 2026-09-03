"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceClaim, FamilyTree, Person } from "../../lib/types";
import { relatedPeople } from "../../lib/relationships";
import { familyGenerations, lifeStatus } from "../../lib/life-status";
import { useLanguage } from "./LanguageContext";

type FamilyNote = { id: string; personId: string; authorName: string; body: string; createdAt: string };

type Props = {
  person: Person;
  tree: FamilyTree;
  canEdit: boolean;
  canComment: boolean;
  preview?: boolean;
  onClose: () => void;
  onSelect: (person: Person) => void;
  onTreeChange: (tree: FamilyTree) => void;
};

function locationLine(city: string | null, country: string | null, fallback: string | null) {
  return city || country ? [city, country].filter(Boolean).join(", ") : fallback;
}

/** autoOpen mounts straight into the input, so a caller can offer a field
 *  without writing anything to it; onDone fires whenever editing ends, saved
 *  or abandoned, so the caller can put its own state back. */
function InlineText({ value, placeholder, canEdit, multiline, className, inputType, autoOpen, onDone, onSave }: { value: string | null; placeholder: string; canEdit: boolean; multiline?: boolean; className?: string; inputType?: string; autoOpen?: boolean; onDone?: () => void; onSave: (next: string) => void }) {
  const [editing, setEditing] = useState(Boolean(autoOpen));
  const [draft, setDraft] = useState(autoOpen ? value ?? "" : "");
  if (!canEdit) return value ? <span className={className}>{value}</span> : null;
  if (!editing) {
    return <button type="button" className={`inline-edit ${value ? "" : "is-empty"} ${className ?? ""}`} title="Click to edit" onClick={() => { setDraft(value ?? ""); setEditing(true); }}>{value || placeholder}</button>;
  }
  const close = () => { setEditing(false); onDone?.(); };
  const commit = () => { close(); if (draft.trim() !== (value ?? "")) onSave(draft.trim()); };
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") close();
    if (event.key === "Enter" && !multiline) (event.target as HTMLElement).blur();
  };
  return multiline
    ? <textarea className={`modal-input inline-input inline-input-multiline ${className ?? ""}`} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={keys} />
    : <input className={`modal-input inline-input ${className ?? ""}`} type={inputType ?? "text"} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={keys} />;
}

function LinkedText({ text, people, exceptId, onSelect }: { text: string; people: Person[]; exceptId: string; onSelect: (person: Person) => void }) {
  const nodes = useMemo(() => {
    const candidates = people
      .filter((person) => person.id !== exceptId && person.displayName.length >= 4)
      .sort((a, b) => b.displayName.length - a.displayName.length);
    const pattern = candidates.map((person) => person.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    if (!pattern) return [text];
    const regex = new RegExp(`(${pattern})`, "gi");
    const byLower = new Map(candidates.map((person) => [person.displayName.toLocaleLowerCase(), person]));
    return text.split(regex).map((part, index) => {
      const person = byLower.get(part.toLocaleLowerCase());
      if (person) return <button type="button" className="bio-link" key={index} onClick={() => onSelect(person)}>{part}</button>;
      return part;
    });
  }, [text, people, exceptId, onSelect]);
  return <>{nodes}</>;
}

/** The family talking to each other about a record. Any signed-in member may
 * leave one; you can delete your own, and an admin can delete any. */
function PersonComments({ personId }: { personId: string }) {
  const { t } = useLanguage();
  const [comments, setComments] = useState<FamilyNote[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/comments").then((response) => response.ok ? response.json() as Promise<{ comments: FamilyNote[]; me: string }> : null)
      .then((data) => { if (!cancelled && data) { setComments(data.comments); setMe(data.me); } })
      .catch(() => { /* signed-out visitors simply see no thread */ });
    return () => { cancelled = true; };
  }, []);
  if (comments === null) return null;
  const mine = comments.filter((comment) => comment.personId === personId);
  const send = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const response = await fetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { comments?: FamilyNote[]; me?: string };
      if (data.comments) { setComments(data.comments); setMe(data.me ?? me); }
    } finally { setBusy(false); }
  };
  return <div className="person-comments">
    <div className="relationship-heading"><p className="eyebrow">{t("person.notes")}</p></div>
    {mine.length > 0 && <div className="comment-list">{mine.map((comment) => <div className="comment" key={comment.id}>
      <p className="comment-body">{comment.body}</p>
      <p className="comment-meta">{comment.authorName} · {new Date(comment.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        {me && <button type="button" className="comment-remove" onClick={() => send({ action: "remove", commentId: comment.id })} aria-label={t("person.deleteNote")}>×</button>}
      </p>
    </div>)}</div>}
    <div className="comment-compose">
      <textarea className="modal-input" value={draft} placeholder={t("person.notePlaceholder")} rows={2}
        onChange={(event) => setDraft(event.target.value)} aria-label="Add a note about this person" />
      <button type="button" className="fill-save" disabled={busy || !draft.trim()} onClick={async () => { await send({ personId, body: draft }); setDraft(""); }}>{t("person.postNote")}</button>
    </div>
  </div>;
}

const claimFieldLabel = (predicate: string) => predicate
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/^./, (letter) => letter.toUpperCase());

function PersonSources({ personId }: { personId: string }) {
  const [claims, setClaims] = useState<EvidenceClaim[] | null>(null);
  const [busyClaim, setBusyClaim] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/claims?subjectType=person&subjectId=${encodeURIComponent(personId)}`)
      .then((response) => response.ok ? response.json() as Promise<{ claims: EvidenceClaim[] }> : null)
      .then((data) => { if (!cancelled && data) setClaims(data.claims); })
      .catch(() => { if (!cancelled) setClaims([]); });
    return () => { cancelled = true; };
  }, [personId]);
  if (claims === null) return <div className="person-sources"><p className="eyebrow">Sources</p><p className="source-empty">Loading sources…</p></div>;
  const disputed = claims.filter((claim) => claim.status === "disputed");
  const adjudicate = async (claimId: string, status: "preferred" | "rejected") => {
    setBusyClaim(claimId);
    try {
      const response = await fetch("/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimId, status }) });
      const data = await response.json() as { claims?: EvidenceClaim[] };
      if (response.ok && data.claims) setClaims(data.claims);
    } finally { setBusyClaim(null); }
  };
  return <div className="person-sources">
    <div className="relationship-heading"><p className="eyebrow">Sources</p>{disputed.length > 0 && <span className="source-review">{disputed.length} need review</span>}</div>
    {claims.length === 0
      ? <p className="source-empty">No claim-level sources have been recorded for this legacy record yet.</p>
      : <div className="source-list">{claims.map((claim) => <article className={`source-claim is-${claim.status}`} key={claim.id}>
        <div><strong>{claimFieldLabel(claim.predicate)}</strong><span>{claim.value || "Removed"}</span></div>
        <p>{claim.sourceLabel} · {claim.confidence}% confidence{claim.status !== "preferred" ? ` · ${claim.status}` : ""}</p>
        {claim.sourceExcerpt && <blockquote>{claim.sourceExcerpt}</blockquote>}
        {claim.attachmentId && <a href={`/api/files/${claim.attachmentId}`} target="_blank" rel="noreferrer">Open evidence</a>}
        {claim.status === "disputed" && <div className="source-actions"><button type="button" disabled={busyClaim === claim.id} onClick={() => void adjudicate(claim.id, "preferred")}>Use this value</button><button type="button" disabled={busyClaim === claim.id} onClick={() => void adjudicate(claim.id, "rejected")}>Reject</button></div>}
      </article>)}</div>}
  </div>;
}

export default function PersonProfilePanel({ person, tree, canEdit, canComment, onClose, onSelect, onTreeChange, preview }: Props) {
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [relationEditor, setRelationEditor] = useState<string | null>(null);
  const [relativeQuery, setRelativeQuery] = useState("");
  const [relativeChoice, setRelativeChoice] = useState("");
  const [editingBio, setEditingBio] = useState(false);
  const [photoShare, setPhotoShare] = useState<string | null>(null);
  // "record a death" opens the field; it does not fill it in
  const [recordingDeath, setRecordingDeath] = useState(false);
  const [shareQuery, setShareQuery] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState("");
  const [mergeChoice, setMergeChoice] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const buckets = relatedPeople(tree, person.id);
  const stories = tree.stories.filter((story) => story.personIds.includes(person.id));
  // the portrait leads the row - it is the photograph of the person, and the
  // rest of their photographs follow it rather than living somewhere else
  const photos = (person.photoIds ?? (person.photoAttachmentId ? [person.photoAttachmentId] : []))
    .slice().sort((a, b) => Number(b === person.photoAttachmentId) - Number(a === person.photoAttachmentId));
  async function post(body: Record<string, unknown>) { const response = await fetch("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json() as { tree?: FamilyTree; error?: string }; if (!response.ok || !data.tree) throw new Error(data.error || "Request failed"); onTreeChange(data.tree); return data.tree; }
  async function patchFields(patch: Record<string, string>) { try { await post({ action: "update", personId: person.id, patch }); setNotice("Saved"); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save"); } }
  const patchField = (key: string) => (value: string) => patchFields({ [key]: value });
  async function removeRelationship(id: string) { try { await post({ action: "remove_relationship", relationshipId: id }); setNotice("Relationship removed"); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not remove relationship"); } }
  async function deletePerson() { if (!window.confirm(`Remove ${person.displayName} and their family-tree connections? This cannot be undone.`)) return; setSaving(true); try { await post({ action: "remove", personId: person.id }); onClose(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not remove person"); } finally { setSaving(false); } }
  async function addRelative(label: string) {
    if (!relativeQuery.trim() || saving) return;
    setSaving(true); setNotice("");
    try {
      let relative = tree.people.find((candidate) => candidate.id === relativeChoice);
      if (!relative) {
        const exact = tree.people.filter((candidate) => candidate.displayName.localeCompare(relativeQuery.trim(), undefined, { sensitivity: "base" }) === 0 && candidate.id !== person.id);
        if (exact.length > 1) throw new Error("Choose the correct matching person from the suggestions.");
        relative = exact[0];
      }
      if (!relative) {
        const before = new Set(tree.people.map((candidate) => candidate.id));
        const next = await post({ action: "add", displayName: relativeQuery.trim() });
        relative = next.people.find((candidate) => !before.has(candidate.id));
      }
      if (!relative) throw new Error("Could not identify that person.");
      const links = label === "Parents" ? [{ fromPersonId: relative.id, toPersonId: person.id }]
        : label === "Children" ? [{ fromPersonId: person.id, toPersonId: relative.id }]
        : label === "Spouse" ? [{ fromPersonId: person.id, toPersonId: relative.id, relationshipType: "spouse" }]
        : buckets.parents.map((parent) => ({ fromPersonId: parent.id, toPersonId: relative!.id }));
      if (!links.length) throw new Error("Add a parent first so this sibling can share the correct parents.");
      for (const link of links) await post({ action: "relationship", relationshipType: "parent", ...link });
      setRelationEditor(null); setRelativeQuery(""); setRelativeChoice(""); setNotice(`${label.replace(/s$/, "")} added`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not add relative"); }
    finally { setSaving(false); }
  }
  /* Three answers, not two: the archive records a death, or has reason to
     think someone is living, or does not know. It used to read a missing
     death date as a life, which had it calling Haj Chorok - born 1720 -
     living, along with 400 others. */
  const generations = useMemo(() => familyGenerations(tree), [tree]);
  const status = lifeStatus(person, generations);
  const deathRecorded = status === "died";
  const presumedLiving = status === "living";
  const subtitleRest = [person.birthDate ? (person.deathDate ? `${person.birthDate.slice(0, 4)}–${person.deathDate.slice(0, 4)}` : `b. ${person.birthDate.slice(0, 4)}`) : person.deathDate ? `d. ${person.deathDate.slice(0, 4)}` : "", locationLine(person.birthCity, person.birthCountry, person.birthPlace) ?? ""].filter(Boolean).join(" · ");
  const relation = (other: Person, label: string) => tree.relationships.find((link) => (label === "Spouse" && link.type === "spouse" && ((link.fromPersonId === person.id && link.toPersonId === other.id) || (link.toPersonId === person.id && link.fromPersonId === other.id))) || (label === "Parents" && link.type === "parent" && link.fromPersonId === other.id && link.toPersonId === person.id) || (label === "Children" && link.type === "parent" && link.fromPersonId === person.id && link.toPersonId === other.id));
  return <section className="person-modal person-modal-v2 person-panel" role="dialog" aria-labelledby="person-modal-title">
    <header className="person-panel-bar">
      <div className="person-nav">
        <button type="button" onClick={() => window.history.back()} aria-label={t("person.previous")} title={t("person.previous")}>‹</button>
        <button type="button" onClick={() => window.history.forward()} aria-label={t("person.next")} title={t("person.next")}>›</button>
      </div>
      <button type="button" className="person-nav-close" onClick={onClose} aria-label={t("person.close")}>×</button>
    </header>
    <input ref={photoRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const body = new FormData(); body.set("personId", person.id); body.set("photo", file); const response = await fetch("/api/people", { method: "POST", body }); const data = await response.json() as { tree?: FamilyTree; error?: string }; if (response.ok && data.tree) { onTreeChange(data.tree); setNotice("Photo updated"); } else setNotice(data.error || "Could not upload photo"); event.target.value = ""; }} />
    <div className="person-modal-hero is-stacked">
      <div className="person-hero-copy">
        <h2 id="person-modal-title" className="font-serif text-4xl"><InlineText value={person.displayName} placeholder="Name" canEdit={canEdit} onSave={patchField("displayName")} /></h2>
        <p className="person-subtitle">
          {person.gender === "female" && (person.maidenName || canEdit) && <span className="person-maiden">{person.maidenName ? `${t("person.nee")} ` : ""}<InlineText value={person.maidenName} placeholder="add maiden name" canEdit={canEdit} onSave={patchField("maidenName")} />{subtitleRest ? " · " : ""}</span>}
          {subtitleRest}
        </p>
        <div className="person-gender-row">{(["female", "male"] as const).map((option) => <button key={option} type="button" className={`gender-pick ${person.gender === option ? "is-active" : ""}`} disabled={!canEdit} onClick={() => canEdit && patchField("gender")(person.gender === option ? "" : option)}>{option === "female" ? t("person.female") : t("person.male")}</button>)}</div>
      </div>
    </div>
    {(photos.length > 0 || canEdit) && <div className="person-photos">
      <div className="relationship-heading"><p className="eyebrow">{t("person.photographs")}</p>{canEdit && <button type="button" className="relationship-add" onClick={() => photoRef.current?.click()} aria-label="Add a photograph">＋</button>}</div>
      <div className="photo-grid">
        {photos.map((id) => <div className={`photo-tile ${id === person.photoAttachmentId ? "is-portrait" : ""}`} key={id}>
          <img src={`/api/photos/${id}`} alt="" loading="lazy" />
          {canEdit && <div className="photo-tile-actions">
            {id !== person.photoAttachmentId && <button type="button" onClick={async () => { try { await post({ action: "set_portrait", personId: person.id, attachmentId: id }); setNotice("Portrait set"); } catch { setNotice("Could not set the portrait"); } }}>{t("person.portrait")}</button>}
            <button type="button" onClick={() => setPhotoShare(id)}>{t("person.whoElse")}</button>
            <button type="button" className="is-danger" data-action="unlink" onClick={async () => { try { await post({ action: "unlink_photo", personId: person.id, attachmentId: id }); setNotice("Removed from this record"); } catch { setNotice("Could not remove the photograph"); } }}>{t("person.removePhoto")}</button>
          </div>}
          {id === person.photoAttachmentId && <span className="photo-tile-badge">{t("person.portrait")}</span>}
        </div>)}
        {canEdit && <button type="button" className="photo-tile photo-tile-add" onClick={() => photoRef.current?.click()} title={t("person.addPhoto")} aria-label={t("person.addPhoto")}>＋</button>}
      </div>
      {photoShare && <div className="relative-picker">
        <input className="modal-input" autoFocus value={shareQuery} placeholder={t("person.whoElsePrompt")} onChange={(event) => setShareQuery(event.target.value)} />
        {shareQuery.trim() && <div className="relative-suggestions">{tree.people.filter((candidate) => candidate.id !== person.id && !(candidate.photoIds ?? []).includes(photoShare) && candidate.displayName.toLocaleLowerCase().includes(shareQuery.trim().toLocaleLowerCase())).slice(0, 6).map((candidate) => <button type="button" key={candidate.id} onClick={async () => { try { await post({ action: "link_photo", personId: candidate.id, attachmentId: photoShare }); setNotice(`Added to ${candidate.displayName}`); setPhotoShare(null); setShareQuery(""); } catch { setNotice("Could not add them to the photograph"); } }}><strong>{candidate.displayName}</strong><span>{candidate.birthDate?.slice(0, 4) || "Year unknown"}</span></button>)}</div>}
        <button type="button" className="fill-skip" onClick={() => { setPhotoShare(null); setShareQuery(""); }}>{t("person.done")}</button>
      </div>}
    </div>}
    <div className="person-facts">
      <div><span className="eyebrow">{t("person.born")}</span><p className="fact-line"><InlineText value={person.birthDate} placeholder="add date" canEdit={canEdit} onSave={patchField("birthDate")} className="fact-date" />{(canEdit || person.birthCity || person.birthCountry) && <> in <InlineText value={person.birthCity} placeholder="city" canEdit={canEdit} onSave={patchField("birthCity")} />{(canEdit || (person.birthCity && person.birthCountry)) && ", "}<InlineText value={person.birthCountry} placeholder="country" canEdit={canEdit} onSave={patchField("birthCountry")} /></>}{!canEdit && !person.birthDate && t("person.birthNotRecorded")}</p></div>
      {/* No death date does not mean "died, date unknown": someone born within a
          lifetime is presumed living, and the record only asks for a death once
          there is reason to think there was one. Offering the death field must
          not itself record one - the prompt opens an empty input, and nothing
          is written until a date is typed - and a death entered by mistake has
          to be reversible, which is what the correction below is for. */}
      <div><span className="eyebrow">{deathRecorded ? t("person.died") : presumedLiving ? t("person.living") : t("person.death")}</span><p className="fact-line">
        {deathRecorded || recordingDeath || !presumedLiving
          ? <><InlineText value={person.deathDate} placeholder={canEdit ? "add date" : ""} canEdit={canEdit} autoOpen={recordingDeath} onDone={() => setRecordingDeath(false)} onSave={patchField("deathDate")} className="fact-date" />{(canEdit || person.deathCity || person.deathCountry) && <> in <InlineText value={person.deathCity} placeholder="city" canEdit={canEdit} onSave={patchField("deathCity")} />{(canEdit || (person.deathCity && person.deathCountry)) && ", "}<InlineText value={person.deathCountry} placeholder="country" canEdit={canEdit} onSave={patchField("deathCountry")} /></>}{!canEdit && !person.deathDate && t("person.notRecorded")}</>
          : canEdit
            ? <button type="button" className="inline-edit is-empty" onClick={() => setRecordingDeath(true)}>{t("person.recordDeath")}</button>
            : <>{t("person.stillLiving")}</>}
      </p>
      {canEdit && deathRecorded && <button type="button" className="fact-clear" title={t("person.clearDeath")} aria-label={t("person.clearDeath")}
        onClick={() => void patchFields({ deathDate: "", deathCity: "", deathCountry: "", burialPlace: "" })}>×</button>}
      </div>
      {/* only for the living: where a person died is already recorded above */}
      {presumedLiving && (person.residence || canEdit) && <div className="person-fact-wide"><span className="eyebrow">{t("person.lives")}</span><p className="fact-line"><InlineText value={person.residence} placeholder={t("person.residencePlaceholder")} canEdit={canEdit} onSave={patchField("residence")} /></p></div>}
      {(person.burialPlace || (canEdit && deathRecorded)) && <div className="person-fact-wide"><span className="eyebrow">{t("person.buried")}</span><p className="fact-line"><InlineText value={person.burialPlace} placeholder={t("person.burialPlaceholder")} canEdit={canEdit} onSave={patchField("burialPlace")} /></p></div>}
    </div>
    {(person.biography || canEdit) && <div className="person-biography-block">
      <div className="relationship-heading"><p className="eyebrow">{t("person.biography")}</p></div>
      {editingBio
        ? <InlineTextAlwaysOpen value={person.biography} onSave={async (value) => { await patchField("biography")(value); setEditingBio(false); }} onCancel={() => setEditingBio(false)} />
        : person.biography
          ? <p className={`person-biography ${canEdit ? "is-editable" : ""}`} title={canEdit ? "Click to edit the biography" : undefined} onClick={(event) => { if (!canEdit) return; if ((event.target as HTMLElement).closest(".bio-link")) return; setEditingBio(true); }}><LinkedText text={person.biography} people={tree.people} exceptId={person.id} onSelect={onSelect} /></p>
          : canEdit && <button type="button" className="inline-edit is-empty bio-add" onClick={() => setEditingBio(true)}>{t("person.addBiography")}</button>}
    </div>}
    {stories.length > 0 && <div className="person-stories">
      <div className="relationship-heading"><p className="eyebrow">{t("person.stories")}</p></div>
      {stories.map((story) => <details className="story-card" key={story.id}>
        <summary><span className="story-title">{story.title}</span>{story.date && <span className="story-year">{story.date.slice(0, 4)}</span>}</summary>
        <p className="story-body" dir="auto">{story.body}</p>
        <p className="story-source">From the family archive{story.place ? ` · ${story.place}` : ""}</p>
        {/* the family wrote these in Persian; the English above is a translation
            of those words, and dir=auto lets the original set its own direction */}
        {story.originalBody && <details className="story-original">
          <summary>{t("person.readOriginal")}</summary>
          <p className="story-body" dir="auto">{story.originalBody}</p>
        </details>}
      </details>)}
    </div>}
    <div className="modal-relationships">{([["Parents", buckets.parents], ["Siblings", buckets.siblings], ["Spouse", buckets.spouses], ["Children", buckets.children]] as [string, Person[]][]).filter(([, people]) => canEdit || people.length > 0).map(([label, people]) => <div className="relationship-group" key={label}><div className="relationship-heading"><p className="eyebrow">{t(`person.${label.toLocaleLowerCase()}`)}</p>{canEdit && <button type="button" className="relationship-add" onClick={() => { setRelationEditor(relationEditor === label ? null : label); setRelativeQuery(""); setRelativeChoice(""); }} aria-label={`Add ${label.toLocaleLowerCase()}`}>＋</button>}</div>{people.length > 0 && <div className="relationship-rows">{people.map((relative) => { const link = relation(relative, label); return <div className="relationship-row" key={relative.id}><button className="relationship-row-main" onClick={() => onSelect(relative)}><span className="rel-name">{relative.displayName}</span><span className="rel-meta">{[relative.birthDate?.slice(0, 4), label === "Spouse" ? link?.status ?? undefined : undefined].filter(Boolean).join(" · ")}</span></button>{label === "Spouse" && canEdit && link && <select className="marriage-status" value={link.status ?? ""} aria-label={`Marriage status with ${relative.displayName}`} onChange={async (event) => { try { await post({ action: "relationship_status", relationshipId: link.id, status: event.target.value || null }); setNotice("Marriage status saved"); } catch { setNotice("Could not save status"); } }}><option value="">married</option><option value="divorced">divorced</option><option value="widowed">widowed</option></select>}{canEdit && link && <button className="relationship-remove" onClick={() => removeRelationship(link.id)} aria-label={`Remove ${relative.displayName}`}>×</button>}</div>; })}</div>}{relationEditor === label && <div className="relative-picker"><input className="modal-input" value={relativeQuery} autoFocus placeholder={`Find or create a ${label.toLocaleLowerCase().replace(/s$/, "")}`} onChange={(event) => { setRelativeQuery(event.target.value); setRelativeChoice(""); }} />{relativeQuery.trim() && <div className="relative-suggestions">{tree.people.filter((candidate) => candidate.id !== person.id && candidate.displayName.toLocaleLowerCase().includes(relativeQuery.trim().toLocaleLowerCase())).slice(0, 6).map((candidate) => <button type="button" key={candidate.id} onClick={() => { setRelativeChoice(candidate.id); setRelativeQuery(candidate.displayName); }}><strong>{candidate.displayName}</strong><span>{candidate.birthDate?.slice(0, 4) || "Year unknown"}{locationLine(candidate.birthCity, candidate.birthCountry, candidate.birthPlace) ? ` · ${locationLine(candidate.birthCity, candidate.birthCountry, candidate.birthPlace)}` : ""}</span></button>)}</div>}<button type="button" className="relative-add-button" disabled={!relativeQuery.trim() || saving} onClick={() => addRelative(label)}>{relativeChoice ? "Add selected person" : "Use this name"}</button></div>}</div>)}</div>
    {/* the hover card is a glance, not a visit: PersonComments fetches the
        whole comment list on mount, and remounting it for every card the
        pointer crosses is a request each time */}
    {!preview && canEdit && <PersonSources personId={person.id} />}
    {!preview && canComment && <PersonComments personId={person.id} />}
    {notice && <p className="modal-notice" role="status">{notice}</p>}
    {canEdit && mergeOpen && <div className="merge-person-box"><p className="eyebrow">Merge duplicate</p><p className="source-empty">Choose the canonical record. Everything linked to {person.displayName} will move there, and the merge can be undone from History.</p><input className="modal-input" autoFocus value={mergeQuery} placeholder="Find the person to keep" onChange={(event) => { setMergeQuery(event.target.value); setMergeChoice(""); }} />{mergeQuery.trim() && <div className="relative-suggestions">{tree.people.filter((candidate) => candidate.id !== person.id && candidate.displayName.toLocaleLowerCase().includes(mergeQuery.trim().toLocaleLowerCase())).slice(0, 6).map((candidate) => <button type="button" key={candidate.id} onClick={() => { setMergeChoice(candidate.id); setMergeQuery(candidate.displayName); }}><strong>{candidate.displayName}</strong><span>{candidate.birthDate?.slice(0, 4) || "Year unknown"}{locationLine(candidate.birthCity, candidate.birthCountry, candidate.birthPlace) ? ` · ${locationLine(candidate.birthCity, candidate.birthCountry, candidate.birthPlace)}` : ""}</span></button>)}</div>}<div className="fill-actions"><button type="button" className="fill-save" disabled={!mergeChoice || saving} onClick={async () => { const target = tree.people.find((candidate) => candidate.id === mergeChoice); if (!target || !window.confirm(`Merge ${person.displayName} into ${target.displayName}?`)) return; setSaving(true); try { await post({ action: "merge", sourcePersonId: person.id, targetPersonId: target.id, summary: `Merged duplicate ${person.displayName} into ${target.displayName}` }); onSelect(target); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not merge records"); } finally { setSaving(false); } }}>Merge records</button><button type="button" className="fill-skip" onClick={() => setMergeOpen(false)}>Cancel</button></div></div>}
    {canEdit && <div className="person-delete-footer"><button className="photo-remove-button" onClick={() => { setMergeOpen((open) => !open); setMergeQuery(""); setMergeChoice(""); }}>Merge duplicate</button>{person.photoAttachmentId && <button className="photo-remove-button" onClick={async () => { try { await post({ action: "remove_photo", personId: person.id }); setNotice("Photo removed"); } catch { setNotice("Could not remove photo"); } }}>{t("person.removePortrait")}</button>}<button className="person-delete-button" disabled={saving} onClick={deletePerson}>{t("person.delete")}</button></div>}
  </section>;
}

function InlineTextAlwaysOpen({ value, onSave, onCancel }: { value: string | null; onSave: (next: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value ?? "");
  return <div className="bio-editor">
    <textarea className="modal-input inline-input-multiline" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
    <div className="fill-actions"><button type="button" className="fill-save" onClick={() => onSave(draft.trim())}>Save</button><button type="button" className="fill-skip" onClick={onCancel}>Cancel</button></div>
  </div>;
}
