"use client";

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AgentConflict, Attachment, ChangeProposal, FamilyTree, Person } from "../../lib/types";
import IdentifyMe from "./IdentifyMe";
import type { MappedPlace } from "../../lib/archive-views";
import { Silhouette, TreeSearch } from "./TreePrimitives";
import { FamilyTreeCanvas } from "./FamilyTreeCanvas";
import { Markdown } from "./Markdown";
import { useLanguage } from "./LanguageContext";
import { useWebMcp } from "./useWebMcp";
import { webMcpAvailable } from "../../lib/webmcp-register";
import { DemoIntro } from "./DemoIntro";
import { LANGUAGES, LANGUAGE_FLAGS, LANGUAGE_NAMES } from "../../lib/i18n";
import { BUILD_ID, VERSION } from "../../lib/build";
import { isUsefulArchivePath, selectedFileKey, selectedFilePath } from "../../lib/upload-policy";

const TimelineView = lazy(() => import("./ArchiveViews").then((module) => ({ default: module.TimelineView })));
const CalendarView = lazy(() => import("./ArchiveViews").then((module) => ({ default: module.CalendarView })));
const WorldMapView = lazy(() => import("./ArchiveViews").then((module) => ({ default: module.WorldMapView })));
const StatisticsView = lazy(() => import("./ArchiveViews").then((module) => ({ default: module.StatisticsView })));
const FocusFamilyView = lazy(() => import("./TreeViews").then((module) => ({ default: module.FocusFamilyView })));
const OutlineView = lazy(() => import("./TreeViews").then((module) => ({ default: module.OutlineView })));
const MissingDataView = lazy(() => import("./TreeViews").then((module) => ({ default: module.MissingDataView })));
const PersonProfilePanel = lazy(() => import("./PersonProfilePanel"));

type Props = {
  initialTree: FamilyTree | null;
  viewer: { signedIn: boolean; canEdit: boolean; role: "admin" | "canEdit" | "canView" | null; personId?: string | null; displayName: string | null };
  signOutPath: string;
  signInEnabled: boolean;
  webMcpDemo?: boolean;
};

type ChatMessage = { role: "user" | "assistant"; text: string };
type Greeting = { fact: string | null; personId: string | null; factoids: { text: string; ask: string; personId: string | null }[] };

function proposalRank(proposal: ChangeProposal) {
  if (proposal.kind === "add_person") return 0;
  if (proposal.kind === "update_person") return 1;
  if (proposal.kind === "add_relationship") return 2;
  if (proposal.kind === "add_story" || proposal.kind === "update_story") return 3;
  return 4;
}


function appendSelectedFiles(current: File[], incoming: File[], fromFolder = false): File[] {
  const known = new Set(current.map(selectedFileKey));
  const additions = incoming.filter((file) => {
    if (fromFolder && !isUsefulArchivePath(selectedFilePath(file))) return false;
    const key = selectedFileKey(file);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  return [...current, ...additions];
}

const EMPTY_TREE: FamilyTree = { people: [], relationships: [], stories: [] };
const VIEW_MODES = ["tree", "family", "list", "timeline", "calendar", "map", "stats", "fill"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const VIEW_KEYS: Record<ViewMode, string> = { tree: "view.tree", family: "view.family", list: "view.list", timeline: "view.timeline", calendar: "view.calendar", map: "view.map", stats: "view.stats", fill: "view.fill" };

export default function FamilyTreeApp({ initialTree, viewer, signOutPath, signInEnabled, webMcpDemo }: Props) {
  const { t, lang, setLang } = useLanguage();
  const [tree, setTree] = useState(initialTree ?? EMPTY_TREE);
  const [treeLoaded, setTreeLoaded] = useState(Boolean(initialTree));
  useEffect(() => {
    if (treeLoaded) return;
    let cancelled = false;
    fetch("/api/tree")
      .then((response) => response.json() as Promise<FamilyTree>)
      .then((data) => { if (!cancelled) { setTree(data); setTreeLoaded(true); } })
      .catch(() => { if (!cancelled) setTreeLoaded(true); });
    return () => { cancelled = true; };
  }, [treeLoaded]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<string[]>(viewer.personId ? [viewer.personId] : []);
  // Where the archive opens: on the person this account says it is, if it
  // has said, and otherwise on the family it has always opened on.
  const [identity, setIdentity] = useState<string | null>(viewer.personId ?? null);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [focalId, setFocalId] = useState<string | null>(viewer.personId ?? null);
  /* Everything on this page is server-rendered before React attaches, so a
     click landing in that window is silently lost - the button is there, the
     handler is not. The attribute says when the page can actually be used;
     written straight to the node, because a state flag would re-render the
     whole app for nothing. */
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { if (mainRef.current) mainRef.current.dataset.hydrated = "true"; }, []);
  const treeRef = useRef(initialTree ?? EMPTY_TREE);
  useEffect(() => { treeRef.current = tree; }, [tree]);
  const openPerson = (person: Person, push = true, refocus = true) => {
    if (refocus) setFocalId(person.id);
    setSelectedPerson(person);
    setHighlightedIds([person.id]);
    if (push && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("p") !== person.id) {
      window.history.pushState({ personId: person.id }, "", `?p=${person.id}`);
    }
  };
  const closePerson = () => {
    setSelectedPerson(null);
    setHighlightedIds([]);
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("p")) {
      window.history.pushState({ personId: null }, "", window.location.pathname);
    }
  };
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const fromState = (event.state as { personId?: string | null } | null)?.personId;
      const id = fromState !== undefined ? fromState : new URLSearchParams(window.location.search).get("p");
      if (id) {
        const person = treeRef.current.people.find((candidate) => candidate.id === id);
        if (person) { setFocalId(person.id); setSelectedPerson(person); setHighlightedIds([person.id]); }
      } else {
        setSelectedPerson(null);
        setHighlightedIds([]);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (!treeLoaded) return;
    const id = new URLSearchParams(window.location.search).get("p");
    const person = id ? treeRef.current.people.find((candidate) => candidate.id === id) : undefined;
    if (person) {
      setFocalId(person.id);
      setSelectedPerson(person);
      setHighlightedIds([person.id]);
      window.history.replaceState({ personId: person.id }, "", `?p=${person.id}`);
    }
  }, [treeLoaded]);
  // demo instance only: the product intro auto-opens on first landing, and
  // the top pill reopens the WebMCP guide at any time
  const [intro, setIntro] = useState<"about" | "webmcp" | null>(null);
  useEffect(() => {
    if (!webMcpDemo) return;
    // deferred a tick: paint the tree first, then raise the introduction
    let seen = false;
    try { seen = Boolean(window.localStorage.getItem("treetree-intro-seen")); } catch { /* private mode */ }
    if (seen) return;
    // in an agentic browser the intro would cover the view the agent drives;
    // the host's presence (checked at fire time, past the injection window)
    // suppresses the auto-open - the pill still opens it on demand
    const timer = setTimeout(() => { if (!webMcpAvailable()) setIntro("about"); }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeIntro = () => { setIntro(null); try { window.localStorage.setItem("treetree-intro-seen", "1"); } catch { /* private mode */ } };
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  /* In an agentic browser the visitor already has a chat - the agent's own -
   * and this page's tools cover everything ours can do. Detecting a WebMCP
   * host (present at load, or injected within the polling window) collapses
   * the chat sidebar once so the view leads; the edge reveal brings it back,
   * and we never fight a human who reopened it. */
  useEffect(() => {
    let collapsed = false;
    const collapseForAgent = () => {
      if (collapsed) return;
      collapsed = true;
      setChatCollapsed(true);
    };
    if (webMcpAvailable()) { collapseForAgent(); return; }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (webMcpAvailable()) { collapseForAgent(); clearInterval(timer); }
      if (attempts > 20) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  const [hoverPreview, setHoverPreview] = useState<Person | null>(null);
  const [hoverPlace, setHoverPlace] = useState<MappedPlace | null>(null);
  // Map mode: a clicked city opens the panel as a list of its people; opening
  // one of them swaps in the profile, and closing it returns to the list.
  const [placeFocus, setPlaceFocus] = useState<MappedPlace | null>(null);
  // The profile panel takes exactly this width, so the two are one column and
  // no view is ever half-hidden behind a panel.
  const [chatWidth, setChatWidth] = useState(480);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = Number(window.localStorage.getItem("archive-chat-width"));
        if (saved >= 420 && saved <= 620) setChatWidth(saved);
      } catch { /* private mode */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const startChatResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = chatWidth;
    const clampWidth = (value: number) => Math.min(620, Math.max(420, value));
    // a fast resize drag sweeps across the chat text; suspend selection until release
    document.body.style.userSelect = "none";
    const onMove = (move: PointerEvent) => setChatWidth(clampWidth(startWidth + move.clientX - startX));
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      try { window.localStorage.setItem("archive-chat-width", String(clampWidth(startWidth + up.clientX - startX))); } catch { /* private mode */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const [viewMode, setViewModeState] = useState<ViewMode>("tree");
  // The restore runs again once the viewer resolves, which is after the page
  // is interactive - so without this it could put the reader back on the view
  // they had last time, seconds after they clicked a different tab.
  const viewChosen = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (viewChosen.current) return;
      try {
        const saved = window.localStorage.getItem("archive-view");
        if (saved && (VIEW_MODES as readonly string[]).includes(saved) && !(saved === "fill" && !viewer.canEdit)) setViewModeState(saved as ViewMode);
      } catch { /* private mode */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [viewer.canEdit]);
  /* Documents the family sent are read one request at a time, and this is
     what makes the requests: an editor arriving drains whatever is waiting.
     There is no timer anywhere - a standing job is the owner's decision, not
     this code's - so the queue moves when an editor is present, which is also
     when someone is there to see what came of it. */
  const drainRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!viewer.canEdit) return;
    let cancelled = false;
    const run = async () => {
      for (let guard = 0; guard < 20 && !cancelled; guard += 1) {
        let data: { done?: boolean; read?: { filename: string; summary?: string; failed?: string } | null; pending?: number };
        try {
          const response = await fetch("/api/ingest", { method: "POST" });
          if (!response.ok) return;
          data = await response.json();
        } catch { return; }
        if (cancelled) return;
        if (data.done || !data.read) { setIngesting(null); return; }
        setIngesting(data.read.failed
          ? `${data.read.filename} could not be read: ${data.read.failed}`
          : `Read ${data.read.filename} — ${data.read.summary}`);
        try {
          const refreshed = await fetch("/api/people", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "tree" }) });
          const payload = await refreshed.json() as { tree?: FamilyTree };
          if (!cancelled && payload.tree) setTree(payload.tree);
        } catch { /* the next load will show it */ }
        if (!data.pending) return;
      }
    };
    // an upload calls this the moment its files land, so a document sent by
    // someone who is standing right there is read while they are still there
    drainRef.current = () => { void run(); };
    void run();
    return () => { cancelled = true; drainRef.current = null; };
  }, [viewer.canEdit]);

  const setViewMode = (mode: ViewMode) => {
    viewChosen.current = true;
    setViewModeState(mode);
    // Compact width - a phone, or an iPad in Slide Over - is one column: the
    // chat fills it, so choosing a view has to get the chat out of the way or
    // the tab appears to do nothing at all. An iPad has room for both.
    if (typeof window !== "undefined" && window.innerWidth <= 743) setChatCollapsed(true);
    if (mode !== "map") setPlaceFocus(null);
    try { window.localStorage.setItem("archive-view", mode); } catch { /* private mode */ }
  };
  // A browser-side agent (Chrome/Edge WebMCP) driving this page gets the
  // archive's tools with no token - it acts as the member already signed in
  // here - and, uniquely, can move the live UI (focus a person, switch view).
  useWebMcp(treeLoaded ? tree : null, {
    egoId: identity ?? viewer.personId ?? null,
    focusPerson: (person) => openPerson(person),
    setView: (view) => setViewMode(view as ViewMode),
    askArchivist: async (question) => {
      const response = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: question }) });
      const data = await response.json() as { reply?: string; error?: string };
      if (!response.ok) throw new Error(data.error === "openai_not_configured" ? "The archivist AI is not configured on this deployment." : "The archivist could not answer right now.");
      return data.reply || "That detail is not recorded in the archive.";
    },
  });
  // what the archive volunteers before it is asked: an anniversary today, or
  // a fact about the family, with openers worth tapping
  const [greeting, setGreeting] = useState<Greeting | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/greeting")
      .then((response) => response.ok ? response.json() as Promise<Greeting> : null)
      .then((data) => { if (!cancelled && data) setGreeting(data); })
      .catch(() => { /* the chat works without it */ });
    return () => { cancelled = true; };
  }, []);
  const openGreetingPerson = () => {
    const person = greeting?.personId ? tree.people.find((candidate) => candidate.id === greeting.personId) : null;
    if (person) openPerson(person);
  };
  const [authError] = useState(() => typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("auth_error") : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function sendMessage() {
    const text = input.trim();
    if ((!text && !files.length) || busy) return;
    const nextMessages = [...messages, { role: "user" as const, text: text || `Attached ${files.map((file) => file.name).join(", ")}` }];
    setMessages(nextMessages);
    setInput(""); setError(""); setBusy(true);
    const form = new FormData();
    form.set("message", selectedPerson ? `[We are currently viewing the record of ${selectedPerson.displayName} (person id ${selectedPerson.id}). Unless another person is named, apply details and answers to this person.]\n${text}` : text);
    form.set("history", JSON.stringify(messages.slice(-6)));
    form.set("file_manifest", JSON.stringify(files.map((file) => ({ name: file.name, path: selectedFilePath(file), size: file.size, type: file.type }))));
    files.forEach((file) => form.append("files", file));
    try {
      const response = await fetch("/api/agent", { method: "POST", body: form });
      const data = await response.json() as { reply?: string; proposals?: ChangeProposal[]; conflicts?: AgentConflict[]; attachments?: Attachment[]; uiActions?: Array<{ type: "show_person"; displayName: string } | { type: "switch_view"; view: string }>; error?: string };
      if (!response.ok) throw new Error(data.error || "request_failed");
      let latestTree = tree;
      let appliedCount = 0;
      const failures: string[] = [];
      if (data.proposals?.length) {
        const imported = [...data.proposals].sort((left, right) => proposalRank(left) - proposalRank(right));
        for (const proposal of imported) {
          const result = await applyChange(proposal, data.attachments ?? [], text);
          if (result.tree) { latestTree = result.tree; appliedCount += 1; }
          else failures.push(result.error || proposal.summary);
        }
      }
      const applied = appliedCount ? `Done — I applied ${appliedCount} ${appliedCount === 1 ? "update" : "updates"} to the family tree.` : "";
      const failed = failures.length ? `${failures.length} ${failures.length === 1 ? "change needs" : "changes need"} another look: ${failures.join("; ")}` : "";
      const questions = data.conflicts?.map((conflict) => `${conflict.question}\n${conflict.evidence.join(" · ")}`).join("\n\n") || "";
      const assistantText = [applied, failed, questions || (!applied && !failed ? data.reply : "")].filter(Boolean).join("\n\n") || "Done.";
      setMessages([...nextMessages, { role: "assistant", text: assistantText }]);
      // the archivist can drive the page: its UI tool calls execute here, so
      // "show me her branch" moves the canvas instead of asking for a click
      let drove = false;
      for (const action of (data.uiActions ?? []).slice(0, 4)) {
        if (action.type === "switch_view" && (VIEW_MODES as readonly string[]).includes(action.view)) { setViewMode(action.view as ViewMode); drove = true; }
        if (action.type === "show_person") {
          const person = latestTree.people.find((candidate) => candidate.displayName.toLowerCase() === action.displayName.toLowerCase());
          if (person) { openPerson(person); drove = true; }
        }
      }
      const mentioned = latestTree.people.filter((person) => assistantText.toLocaleLowerCase().includes(person.displayName.toLocaleLowerCase()));
      if (mentioned.length && !drove) { setHighlightedIds(mentioned.map((person) => person.id)); setViewMode("tree"); }
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "request_failed";
      const friendly = code === "openai_not_configured"
        ? "The archivist is ready, but the OpenAI key still needs to be connected."
        : code === "unsupported_file_type" ? "That file type is not supported yet. Try a PDF, image, text file, Word document, or spreadsheet."
        : code === "too_many_files" ? "That selection contains too many files. Send a ZIP, or keep the selection under 256 useful files."
        : code === "file_too_large" || code === "files_too_large" ? "Those files are too large. Keep each file under 16 MB and the total under 24 MB."
        : "The archivist could not finish that request. Please try again.";
      setError(friendly);
    } finally { setBusy(false); }
  }

  async function applyChange(proposal: ChangeProposal, evidenceAttachments: Attachment[] = [], assertion = ""): Promise<{ tree?: FamilyTree; error?: string }> {
    try {
      const response = await fetch("/api/changes", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposal, evidenceAttachments, assertion }),
      });
      const data = await response.json() as { tree?: FamilyTree; error?: string };
      if (!response.ok || !data.tree) throw new Error(data.error || "change_failed");
      setTree(data.tree);
      return { tree: data.tree };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Change failed" };
    }
  }

  const focal = useMemo(() => {
    const explicit = focalId ? tree.people.find((person) => person.id === focalId) : undefined;
    if (explicit) return explicit;
    // the archive's own root-person setting decides where a stranger lands
    return (tree.rootPersonId ? tree.people.find((person) => person.id === tree.rootPersonId) : undefined) ?? tree.people[0];
  }, [tree, focalId]);

  return (
    <main ref={mainRef} className={`min-h-screen bg-[var(--paper)] text-[var(--ink)] ${chatCollapsed ? "chat-collapsed" : ""} ${selectedPerson || (placeFocus && viewMode === "map") ? "has-person" : ""}`} style={{ "--chat-width": `${chatWidth}px` } as React.CSSProperties} data-build-id={BUILD_ID} data-version={VERSION} data-hydrated="false">
      {webMcpDemo && <button type="button" className="webmcp-demo-pill" onClick={() => setIntro("webmcp")}>WebMCP demo — drive this page with your browser&rsquo;s agent →</button>}
      {webMcpDemo && intro && <DemoIntro mode={intro} onClose={closeIntro} onSwitch={setIntro} />}
      {authError && <div className="border-b border-[rgba(226,140,115,.35)] bg-[rgba(226,140,115,.12)] px-5 py-3 text-center text-sm text-[#e8a289]">{authError === "not_invited" ? "Apple sign-in worked, but this Apple account is not on the family editor list." : authError === "apple_token_exchange_failed" ? "Apple returned an authentication error. Please try again, and contact the site owner if it continues." : "We could not complete Apple sign-in. Please try again."}</div>}

      <header className={`site-action-bar absolute top-0 z-50 flex h-16 items-center justify-between border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--paper)_92%,transparent)] px-6 backdrop-blur-xl sm:px-8 ${chatCollapsed ? "is-chat-collapsed" : ""}`}>
        {/* Seven segments do not fit a phone, and Apple's answer to a
            segmented control that cannot show its segments is a different
            control - so below the width where the strip fits whole, the views
            are a picker, which on iOS is the native wheel. */}
        <label className="archive-view-picker">
          <span className="sr-only">{t("nav.view")}</span>
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
            {VIEW_MODES.filter((mode) => mode !== "fill" || viewer.canEdit).map((mode) => <option key={mode} value={mode}>{t(VIEW_KEYS[mode])}</option>)}
          </select>
        </label>
        <nav className="archive-view-switcher" aria-label="Archive view">{VIEW_MODES.filter((mode) => mode !== "fill" || viewer.canEdit).map((mode) => <button type="button" className={viewMode === mode ? "is-active" : ""} aria-current={viewMode === mode ? "page" : undefined} onClick={() => setViewMode(mode)} key={mode}>{t(VIEW_KEYS[mode])}</button>)}</nav>
        <div className="relative flex items-center gap-4">
          <div className="lang-switch" role="group" aria-label={t("settings.language")}>
            <span className="lang-switch-label">{t("settings.language")}</span>
            {LANGUAGES.map((code) => <button type="button" key={code} lang={code}
              className={`lang-pick ${lang === code ? "is-active" : ""}`}
              aria-pressed={lang === code} title={LANGUAGE_NAMES[code]}
              onClick={() => setLang(code)}>
              <span aria-hidden="true">{LANGUAGE_FLAGS[code]}</span>
              <span className="lang-pick-name">{LANGUAGE_NAMES[code]}</span>
            </button>)}
          </div>
          <TreeSearch tree={tree} onPick={(person) => openPerson(person)} />
          {signInEnabled && !viewer.signedIn && <a className="rounded-full bg-[var(--accent-fill)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#3a604a]" href="/settings">{t("nav.signIn")}</a>}
          {viewer.signedIn && <><button className="account-menu-button" aria-label={t("nav.account")} onClick={() => setMenuOpen(!menuOpen)}>···</button>{menuOpen && <div className="absolute right-0 top-10 z-50 rounded-xl border border-[var(--line)] bg-[var(--card)] p-1 shadow-lg"><a className="block rounded-lg px-4 py-2 text-sm hover:bg-[var(--wash)]" href="/settings">{t("nav.settings")}</a><a className="block rounded-lg px-4 py-2 text-sm hover:bg-[var(--wash)]" href={signOutPath}>{t("nav.signOut")}</a></div>}</>}
          {!viewer.signedIn && <a className="settings-gear" href="/settings" aria-label="Site settings" title="Site settings">⚙</a>}
        </div>
      </header>
      <div className="family-shell flex h-screen min-h-0">
        <aside className={`chat-sidebar flex min-h-0 flex-col border-b border-[var(--line)] bg-[var(--sidebar)] lg:border-b-0 lg:border-r ${chatCollapsed ? "is-collapsed" : ""}`} aria-label="Family chat">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6 pt-6 sm:px-8">
            <div className="workspace-header mb-5 flex items-center justify-between">
              <span aria-hidden="true" />
              <div className="flex items-center gap-1">
                <button className="sidebar-toggle" onClick={() => setChatCollapsed(true)} aria-label={t("chat.collapse")} title={t("chat.collapse")}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2" /><path d="M7 3v14M11.5 7.5 9 10l2.5 2.5" /></svg>
                </button>
              </div>
            </div>
            {ingesting && <p className="ingest-note" role="status">{ingesting}</p>}
            {viewer.signedIn && viewer.role && !identity && treeLoaded && tree.people.length > 0 && (
              <IdentifyMe tree={tree} onClaimed={(person) => { setIdentity(person.id); openPerson(person); }} />
            )}
            {!viewer.canEdit ? (
              <PublicArchiveChat signedIn={viewer.signedIn} tree={tree} greeting={greeting} focusPerson={selectedPerson} onClearFocus={closePerson} onOpenPerson={(person) => openPerson(person)} onPeopleMentioned={(people) => { setHighlightedIds(people.map((person) => person.id)); setViewMode("tree"); }} webMcpDemo={webMcpDemo} onSwitchView={(view) => setViewMode(view as ViewMode)} />
            ) : (
              <>
                <div className="flex-1 space-y-4 overflow-y-auto pr-1">
                  {!selectedPerson && <div className="max-w-[18rem] rounded-2xl rounded-tl-sm border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-sm leading-6 shadow-sm">
                    {treeLoaded && tree.people.length === 0
                      ? t("chat.genesis", { name: viewer.displayName ? `, ${viewer.displayName.split(" ")[0]}` : "" })
                      : t("chat.welcome", { name: viewer.displayName ? `, ${viewer.displayName.split(" ")[0]}` : "" })}
                  </div>}
                  {!selectedPerson && greeting?.fact && messages.length === 0 && <button type="button" className="chat-fact" onClick={openGreetingPerson} disabled={!greeting.personId}>
                    <span className="chat-fact-label">{t("chat.fromArchive")}</span>
                    <span>{greeting.fact}</span>
                  </button>}
                  {messages.length === 0 && treeLoaded && tree.people.length === 0 && !selectedPerson && <div className="chat-suggestions">{[
                    t("chat.genesisMe"), t("chat.genesisParents"), t("chat.genesisImport"),
                  ].map((prompt) => <button type="button" className="chat-suggestion" key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus(); }}>{prompt}</button>)}</div>}
                  {messages.length === 0 && (selectedPerson
                    ? <div className="chat-suggestions">{[
                        `What do we know about ${selectedPerson.displayName.split(" ")[0]}?`,
                        `${selectedPerson.displayName.split(" ")[0]} was born in …`,
                        `${selectedPerson.displayName.split(" ")[0]} had a sibling named …`,
                      ].map((prompt) => <button type="button" className="chat-suggestion" key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus(); }}>{prompt}</button>)}</div>
                    : greeting?.factoids?.length
                      ? <div className="chat-factoids">{greeting.factoids.map((factoid) => <button type="button" className="chat-factoid" key={factoid.text} onClick={() => { setInput(factoid.ask); inputRef.current?.focus(); }}>
                          <span>{factoid.text}</span>
                          <span className="chat-factoid-ask">{factoid.ask}</span>
                        </button>)}</div>
                      : null)}
                  {messages.map((message, index) => (
                    <div className={`chat-bubble ${message.role === "user" ? "is-user" : ""}`} key={`${message.role}-${index}`}>{message.role === "user" ? message.text : <Markdown text={message.text} />}</div>
                  ))}
                  {busy && <div className="chat-bubble"><span className="agent-pulse" /> {t("chat.thinking")}</div>}
                  {error && <p className="rounded-xl bg-[rgba(226,140,115,.12)] px-3 py-2 text-xs leading-5 text-[#e8a289]">{error}</p>}
                </div>
                <div className="pt-5">
                  {files.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{files.map((file) => <span className="file-chip" key={selectedFileKey(file)}>{file.name}</span>)}</div>}
                  <div className="editor-composer rounded-[1.5rem] border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.3)]">
                    {selectedPerson && <ComposerFocus person={selectedPerson} canEdit onClear={closePerson} />}
                    <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(); } }} className="min-h-20 w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-[var(--muted)]" placeholder={selectedPerson ? t("chat.placeholderPerson", { name: selectedPerson.displayName.split(" ")[0] }) : t("chat.placeholder")} aria-label="Message the family archivist" />
                    <div className="mt-2 flex items-center justify-between">
                      <input ref={sendRef} className="sr-only" type="file" multiple aria-label={t("chat.sendDocuments")} onChange={async (event) => {
                        const chosen = Array.from(event.target.files ?? []);
                        event.target.value = "";
                        if (!chosen.length) return;
                        const body = new FormData();
                        for (const file of chosen) body.append("files", file);
                        setIngesting(`Reading ${chosen.length === 1 ? chosen[0].name : `${chosen.length} documents`}… this can take a minute.`);
                        try {
                          const response = await fetch("/api/documents", { method: "POST", body });
                          if (!response.ok) { setIngesting("Those documents could not be sent."); return; }
                          drainRef.current?.();
                        } catch { setIngesting("Those documents could not be sent."); }
                      }} />
                      <input ref={fileRef} className="sr-only" type="file" multiple onChange={(event) => { const incoming = Array.from(event.target.files ?? []); setFiles((current) => appendSelectedFiles(current, incoming)); event.target.value = ""; }} />
                      <input ref={(node) => { folderRef.current = node; node?.setAttribute("webkitdirectory", ""); node?.setAttribute("directory", ""); }} className="sr-only" type="file" multiple onChange={(event) => { const incoming = Array.from(event.target.files ?? []); setFiles((current) => appendSelectedFiles(current, incoming, true)); event.target.value = ""; }} />
                      <AttachMenu onFiles={() => fileRef.current?.click()} onFolder={() => folderRef.current?.click()} onSend={() => sendRef.current?.click()} />
                      <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-fill)] text-white transition hover:bg-[#3a604a] disabled:opacity-40" disabled={busy || (!input.trim() && !files.length)} onClick={sendMessage} aria-label={t("chat.send")}>↑</button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="chat-resize-handle" onPointerDown={startChatResize} aria-hidden="true" />
        </aside>
        <button className={`chat-edge-reveal ${chatCollapsed ? "is-visible" : ""}`} onClick={() => setChatCollapsed(false)} aria-label={t("chat.reveal")} title={t("chat.reveal")}>›</button>
        {hoverPreview && (viewMode === "family" || viewMode === "list") && hoverPreview.id !== selectedPerson?.id && (
          // the hover preview IS the profile: the same panel a click opens,
          // rendered read-only and inert
          <div className="person-hover-preview" aria-hidden="true">
            <Suspense fallback={null}><PersonProfilePanel key={hoverPreview.id} person={hoverPreview} tree={tree} canEdit={false} canComment={false} preview onClose={() => {}} onSelect={() => {}} onTreeChange={() => {}} /></Suspense>
          </div>
        )}
        {hoverPlace && viewMode === "map" && hoverPlace.key !== placeFocus?.key && (
          <div className="person-hover-preview" aria-hidden="true">
            <PlacePanel key={hoverPlace.key} place={hoverPlace} onPick={() => {}} onClose={() => {}} />
          </div>
        )}
        {!selectedPerson && placeFocus && viewMode === "map" && <PlacePanel place={placeFocus} onPick={(person) => openPerson(person, true, false)} onClose={() => setPlaceFocus(null)} />}
        {selectedPerson && <Suspense fallback={<section className="person-modal person-modal-v2 person-panel" aria-busy="true" aria-label="Loading person" />}><PersonProfilePanel key={selectedPerson.id} person={selectedPerson} tree={tree} canEdit={viewer.canEdit} canComment={Boolean(viewer.role)} onClose={closePerson} onSelect={(person) => openPerson(person)} onTreeChange={(next) => { setTree(next); setSelectedPerson(next.people.find((candidate) => candidate.id === selectedPerson.id) ?? null); }} /></Suspense>}
        <section className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="absolute inset-0 tree-grid opacity-20" aria-hidden="true" />
          <div className="relative h-full min-h-0">

            <div className="relative h-full min-h-0 overflow-hidden stage-bg">
              {viewMode !== "timeline" && viewMode !== "map" && !treeLoaded && <div className="family-canvas" aria-busy="true" aria-label="Loading the family tree" />}
              {viewMode === "tree" && treeLoaded && (tree.people.length ? <FamilyTreeCanvas tree={tree} highlightedIds={highlightedIds} focusPersonId={highlightedIds[0]} onSelect={(person) => openPerson(person)} /> : <EmptyTree canEdit={viewer.canEdit} />)}
              <Suspense fallback={<div className="family-canvas" aria-busy="true" aria-label="Loading view" />}>
                {viewMode === "family" && treeLoaded && (focal ? <FocusFamilyView tree={tree} focusId={focal.id} selectedId={selectedPerson?.id ?? null} canBack canForward onBack={() => window.history.back()} onForward={() => window.history.forward()} onPick={(person) => openPerson(person)} onSelectOnly={(person) => openPerson(person, true, false)} onPreview={setHoverPreview} onOpen={(person) => openPerson(person)} /> : <EmptyTree canEdit={viewer.canEdit} />)}
                {viewMode === "list" && treeLoaded && <OutlineView tree={tree} onSelect={(person) => openPerson(person)} onPreview={setHoverPreview} meId={identity} />}
                {viewMode === "fill" && viewer.canEdit && treeLoaded && <MissingDataView tree={tree} onSaved={setTree} onOpen={(person) => openPerson(person)} />}
                {viewMode === "timeline" && <TimelineView tree={tree} meId={identity} onSelect={(person) => { setHighlightedIds([person.id]); setSelectedPerson(person); }} />}
                {viewMode === "calendar" && treeLoaded && <CalendarView tree={tree} onSelect={(person) => openPerson(person)} />}
                {viewMode === "stats" && treeLoaded && <StatisticsView tree={tree} onSelect={(person) => openPerson(person)} />}
                {viewMode === "map" && <WorldMapView tree={tree} onPreviewPlace={setHoverPlace} onSelectPlace={(place) => { setHoverPlace(null); setPlaceFocus(place); setSelectedPerson(null); setHighlightedIds(place.people.map((person) => person.id)); }} />}
              </Suspense>
            </div>
          </div>
        </section>

      </div>
      <span className="build-version" aria-label={`Archive version ${VERSION}`}>Version {VERSION}</span>
    </main>
  );
}

/** The selection belongs to the input, not to the thread: a chip attached to
 * the top of the composer says whose record the next message goes to, and
 * clears in one click. */
function ComposerFocus({ person, canEdit, onClear }: { person: Person; canEdit: boolean; onClear: () => void }) {
  const { t } = useLanguage();
  const first = person.displayName.split(" ")[0];
  return <div className="composer-focus">
    <span className="composer-focus-chip">
      {person.photoAttachmentId ? <span className="ped-portrait ped-photo"><img src={`/api/photos/${person.photoAttachmentId}`} alt="" /></span> : <Silhouette gender={person.gender} />}
      <strong>{person.displayName}</strong>
      <button type="button" className="composer-focus-clear" onClick={onClear} aria-label={t("chat.clearFocus", { name: person.displayName })} title={t("chat.clearFocus", { name: person.displayName })}>×</button>
    </span>
    <span className="composer-focus-note">{canEdit
      ? t("chat.focusEditor", { name: first })
      : t("chat.focusViewer", { name: first })}</span>
  </div>;
}

/** One ＋ that offers the two kinds of attachment, Apple-menu style. */
function AttachMenu({ onFiles, onFolder, onSend }: { onFiles: () => void; onFolder: () => void; onSend: () => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  return <div className="attach-menu" ref={wrapRef}>
    <button type="button" className="composer-attach" aria-label={t("chat.attach")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>＋</button>
    {open && <div className="attach-popover" role="menu">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onFiles(); }}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 2.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5Z" /><path d="M12 2.5v4h3.5" /></svg>
        {t("chat.addFiles")}
      </button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onFolder(); }}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.75 6.25V5a1.5 1.5 0 0 1 1.5-1.5h3l1.75 2h6.25a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5Z" /></svg>
        {t("chat.addFolder")}
      </button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onSend(); }}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v11" /><path d="M6 6.5 10 2.5l4 4" /><path d="M3.5 13v3a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-3" /></svg>
        {t("chat.sendDocuments")}
      </button>
    </div>}
  </div>;
}

/** The Map panel: everyone the records place in a city, as preview cards.
 * Clicking a card opens the profile in the same slot; closing the profile
 * lands back on this list because the place focus survives it. */
function PlacePanel({ place, onPick, onClose }: { place: MappedPlace; onPick: (person: Person) => void; onClose: () => void }) {
  const { t } = useLanguage();
  const roleIn = (person: Person) => {
    const norm = (value: string | null) => value?.toLocaleLowerCase() ?? "";
    const label = place.label.toLocaleLowerCase();
    const born = label.startsWith(norm(person.birthCity)) && Boolean(person.birthCity);
    const died = label.startsWith(norm(person.deathCity)) && Boolean(person.deathCity);
    if (born && died) return t("place.bornDiedHere");
    if (died) return t("place.diedHere");
    if (born) return t("place.bornHere");
    return ""; // mapped by country only - the dates say enough
  };
  const people = [...place.people].sort((a, b) => (Number(a.birthDate?.slice(0, 4)) || 9999) - (Number(b.birthDate?.slice(0, 4)) || 9999) || a.displayName.localeCompare(b.displayName));
  return <section className="person-modal person-modal-v2 person-panel place-panel" role="dialog" aria-labelledby="place-panel-title">
    <header className="person-panel-bar">
      <span aria-hidden="true" />
      <button type="button" className="person-nav-close" onClick={onClose} aria-label={t("person.close")}>×</button>
    </header>
    <div className="person-hero-copy">
      <h2 id="place-panel-title" className="font-serif text-4xl">{place.label}</h2>
      <p className="person-subtitle">{people.length === 1 ? t("place.onePerson") : t("place.people", { count: people.length })}</p>
    </div>
    <div className="place-people">
      {people.map((person) => {
        const born = person.birthDate?.slice(0, 4), died = person.deathDate?.slice(0, 4);
        const life = born && died ? `${born}–${died}` : born ? `b. ${born}` : died ? `d. ${died}` : "";
        return <button type="button" className="place-person-row" key={person.id} onClick={() => onPick(person)}>
          {person.photoAttachmentId ? <span className="ped-portrait ped-photo"><img src={`/api/photos/${person.photoAttachmentId}`} alt="" /></span> : <Silhouette gender={person.gender} />}
          <span className="place-person-copy">
            <strong>{person.displayName}</strong>
            <span>{[life, roleIn(person)].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="place-person-go" aria-hidden="true">›</span>
        </button>;
      })}
    </div>
  </section>;
}

function EmptyTree({ canEdit }: { canEdit: boolean }) {
  const { t } = useLanguage();
  // the monogram is the archive's own initial, not the reference instance's
  const monogram = (t("archive.name") || "A").trim().charAt(0).toUpperCase();
  return (
    <div className="m-auto flex max-w-md flex-col items-center py-20 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--wash)] font-serif text-2xl text-[var(--accent)]">{monogram}</span>
      <h2 className="mt-5 font-serif text-3xl tracking-[-.025em] text-white">The first branch starts here.</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">{canEdit ? "Tell the archivist about one family member to begin the record." : "The family is gathering names, dates, photographs, and stories for this living archive."}</p>
    </div>
  );
}

const WEBMCP_SHOWCASE = [
  { text: "The same sentences work for your WebMCP browser agent — this chat honours them too.", ask: "Where does this family come from?" },
  { text: "Kinship, computed from the graph in family words.", ask: "How is June Marlowe related to Nina Everfield?" },
  { text: "A life told in order, not a field dump.", ask: "What was Edmund Everfield's life like?" },
  { text: "The agent can drive the page. So can this chat.", ask: "Show Rosalind Everfield on the canvas" },
  { text: "Views are tools too.", ask: "Switch to the map" },
];

function PublicArchiveChat({ signedIn, tree, greeting, focusPerson, onClearFocus, onPeopleMentioned, onOpenPerson, webMcpDemo, onSwitchView }: { signedIn: boolean; tree: FamilyTree; greeting: Greeting | null; focusPerson: Person | null; onClearFocus: () => void; onPeopleMentioned: (people: Person[]) => void; onOpenPerson: (person: Person) => void; webMcpDemo?: boolean; onSwitchView?: (view: string) => void }) {
  const { t } = useLanguage();
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<string[]>([]);
  async function ask() {
    const text = question.trim();
    if (!text || busy) return;
    setAsked((current) => [...current, text]);
    setQuestion("");
    setBusy(true); setReply("");
    // the demo's UI-driving sentences are honoured right here, the same way
    // a WebMCP agent would execute them - no model round-trip needed
    if (webMcpDemo) {
      const show = /^show\s+(.+?)(?:\s+on the canvas)?\s*[.!]?$/i.exec(text);
      const view = /^switch to (?:the )?(tree|family|list|timeline|calendar|map|stats|numbers)(?:\s+view)?\s*[.!]?$/i.exec(text);
      if (view && onSwitchView) {
        onSwitchView(view[1].toLowerCase() === "numbers" ? "stats" : view[1].toLowerCase());
        setReply(`Done — the ${view[1].toLowerCase()} view is on screen. A WebMCP browser agent does this with the page's own switch_view tool.`);
        setBusy(false);
        return;
      }
      if (show) {
        const needle = show[1].trim().toLowerCase();
        const match = tree.people.filter((person) => person.displayName.toLowerCase() === needle || person.displayName.toLowerCase().startsWith(needle));
        if (match.length === 1) {
          onOpenPerson(match[0]);
          setReply(`There — ${match[0].displayName} is centred on the canvas with their record open. A WebMCP browser agent does this with show_person_on_canvas.`);
          setBusy(false);
          return;
        }
      }
    }
    const contextual = focusPerson ? `[We are currently viewing the record of ${focusPerson.displayName}. Unless another person is named, answer about this person.]\n${text}` : text;
    try { const response = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: contextual }) }); const data = await response.json() as { reply?: string; error?: string }; const answer = response.ok ? data.reply || "No answer recorded." : "The archivist could not answer right now."; setReply(answer); onPeopleMentioned(tree.people.filter((person) => answer.toLocaleLowerCase().includes(person.displayName.toLocaleLowerCase()))); } finally { setBusy(false); }
  }
  return (
    <div className="public-chat flex h-full min-h-0 w-full flex-col">
      <div className={`flex flex-1 flex-col items-center overflow-y-auto pb-5 text-center ${asked.length || focusPerson ? "justify-start" : "justify-center"}`}>
        {!asked.length && !focusPerson ? <><h3 className="mt-0 font-serif text-2xl">{t("chat.title")}</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("chat.intro")}</p>{greeting?.fact && <button type="button" className="chat-fact" onClick={() => { const person = greeting.personId ? tree.people.find((candidate) => candidate.id === greeting.personId) : null; if (person) onOpenPerson(person); }} disabled={!greeting.personId}><span className="chat-fact-label">{t("chat.fromArchive")}</span><span>{greeting.fact}</span></button>}{(webMcpDemo ? WEBMCP_SHOWCASE : greeting?.factoids)?.length ? <div className="chat-factoids">{(webMcpDemo ? WEBMCP_SHOWCASE : greeting!.factoids).map((factoid) => <button type="button" className="chat-factoid" key={factoid.text} onClick={() => setQuestion(factoid.ask)}>
          <span>{factoid.text}</span>
          <span className="chat-factoid-ask">{factoid.ask}</span>
        </button>)}</div> : null}{signedIn && <p className="public-chat-note mt-5 text-xs leading-5 text-[var(--muted)]">You&apos;re signed in, but this Apple account isn&apos;t authorized to edit this family tree.</p>}</> : <div className="public-chat-thread w-full pt-4 text-left">{asked.map((message, index) => <div className="public-chat-user-bubble" key={`${message}-${index}`}>{message}</div>)}{busy && <p className="public-chat-syncing"><span className="agent-pulse" /> {t("chat.thinking")}</p>}{!busy && reply && <div className="public-chat-answer"><Markdown text={reply} /></div>}</div>}
      </div>
      <div>
        <div className="public-chat-composer editor-composer relative w-full rounded-[1.5rem] border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.3)]">
          {focusPerson && <ComposerFocus person={focusPerson} canEdit={false} onClear={onClearFocus} />}
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); } }} className="min-h-24 w-full resize-none bg-transparent px-2 py-1 pr-12 text-sm leading-6 outline-none placeholder:text-[var(--muted)]" placeholder={focusPerson ? t("chat.viewerPlaceholderPerson", { name: focusPerson.displayName.split(" ")[0] }) : t("chat.viewerPlaceholder")} aria-label="Search the family archive" />
          <button onClick={ask} disabled={busy || !question.trim()} className="absolute bottom-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-fill)] text-white transition hover:bg-[#3a604a] disabled:opacity-40" aria-label={t("chat.send")}>↑</button>
        </div>
      </div>
    </div>
  );
}
