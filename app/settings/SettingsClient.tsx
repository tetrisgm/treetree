"use client";

import { LANGUAGES, LANGUAGE_NAMES, LANG_COOKIE, type Lang, parseLang } from "../../lib/i18n";

import { useEffect, useState } from "react";

type Role = "admin" | "canEdit" | "canView" | null;
type Identity = { email: string; provider: string | null };
type Member = { email: string; role: "admin" | "canEdit" | "canView"; addedBy: string; createdAt: string; links: Identity[] };
type AgentConnection = { id: string; clientName: string; scope: string; createdAt: string; lastUsedAt: string | null; expiresAt: string };
type Props = {
  viewer: { signedIn: boolean; email: string | null; accountEmail: string | null; displayName: string | null; role: Role; links: Identity[]; connectedProviders: string[] };
  siteVisibility: "public" | "members" | "password" | null;
  agentConnections: AgentConnection[];
  mcpUrl: string;
  appleSignInPath: string;
  googleSignInPath: string | null;
  signOutPath: string;
};

const PROVIDER_LABEL: Record<string, string> = { apple: "Apple", google: "Google" };

const ERROR_COPY: Record<string, string> = {
  invalid_response: "The sign-in response was incomplete. Please try again.",
  google_token_exchange_failed: "Google returned an authentication error. Please try again.",
  apple_token_exchange_failed: "Apple returned an authentication error. Please try again.",
  invalid_identity_token: "The identity token could not be verified. Please try again.",
  sign_in_failed: "We could not complete sign-in. Please try again.",
  last_admin: "That is the last admin — give someone else the admin role first.",
  not_a_member: "That email address is not on the member list.",
  invalid_email: "That does not look like an email address.",
  identity_linked_elsewhere: "That sign-in is already linked to a different member \u2014 unlink it there first.",
};

export default function SettingsClient({ viewer, siteVisibility, agentConnections, mcpUrl, appleSignInPath, googleSignInPath, signOutPath }: Props) {
  const [connections, setConnections] = useState(agentConnections);
  // the cookie is the single source, shared with the server; read it lazily so
  // the first client render already knows which language is chosen
  const [currentLang] = useState<Lang>(() => {
    if (typeof document === "undefined") return "en";
    return parseLang(document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))?.[1]);
  });
  const [visibility, setVisibility] = useState(siteVisibility);
  // The password is write-only: this holds whether one exists, never what it
  // is. The server has no request that would return it.
  const [access, setAccess] = useState<{ hasPassword: boolean; shareUrl: string | null }>({ hasPassword: false, shareUrl: null });
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (siteVisibility === null) return;
    fetch("/api/site").then((response) => response.ok ? response.json() as Promise<{ hasPassword?: boolean; shareUrl?: string | null }> : null)
      .then((data) => {
        if (data) setAccess({ hasPassword: Boolean(data.hasPassword), shareUrl: data.shareUrl ?? null });
      }).catch(() => { /* the rest of the page works without it */ });
  }, [siteVisibility]);
  const accessAction = async (payload: Record<string, unknown>) => {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/site", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { visibility?: "public" | "members" | "password"; hasPassword?: boolean; shareUrl?: string | null; error?: string };
      if (!response.ok) { setNotice(data.error === "password_too_short" ? "Use at least six characters." : data.error === "password_in_use" ? "Choose another way in first — the archive is behind this password." : "That could not be saved."); return; }
      setAccess({ hasPassword: Boolean(data.hasPassword), shareUrl: data.shareUrl ?? null });
      if (data.visibility) setVisibility(data.visibility);
      setPassword("");
    } catch { setNotice("That could not be saved."); }
    finally { setBusy(false); }
  };
  const [members, setMembers] = useState<Member[] | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"canView" | "canEdit" | "admin">("canView");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("auth_error");
    if (requested) requestAnimationFrame(() => setAuthError(ERROR_COPY[requested] ?? ERROR_COPY.sign_in_failed));
  }, []);
  useEffect(() => {
    if (viewer.role !== "admin") return;
    let cancelled = false;
    fetch("/api/members").then((response) => response.json() as Promise<{ members?: Member[] }>).then((data) => {
      if (!cancelled && data.members) setMembers(data.members);
    }).catch(() => { if (!cancelled) setNotice("Could not load the member list."); });
    return () => { cancelled = true; };
  }, [viewer.role]);

  const mutate = async (payload: Record<string, string>) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { members?: Member[]; error?: string };
      if (!response.ok || !data.members) { setNotice(ERROR_COPY[data.error ?? ""] ?? "The change could not be saved."); return; }
      setMembers(data.members);
      if (payload.action === "set" && payload.email === newEmail.trim().toLowerCase()) setNewEmail("");
    } catch {
      setNotice("The change could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const roleRank: Record<string, number> = { admin: 0, editor: 1, viewer: 2 };
  return <main className="settings-page">
    <header className="settings-masthead">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full page load; client-side Link navigation is unreliable here */}
        <a className="settings-back-pill" href="/">← Back to the family tree</a>
    </header>
    <section className="settings-panel">
      <h1>Settings</h1>

      {authError && <p className="settings-error">{authError}</p>}

      {!viewer.signedIn && <div className="settings-card">
        <p>Sign in to see your access. Editing rights are granted on this page by a site admin.</p>
        <div className="settings-signin-row">
          <a className="settings-signin" href={appleSignInPath}> Sign in with Apple</a>
          {googleSignInPath && <a className="settings-signin is-google" href={googleSignInPath}><span aria-hidden="true">G</span> Sign in with Google</a>}
        </div>
      </div>}

      {viewer.signedIn && <div className="settings-card">
        <div className="settings-identity">
          <div>
            <strong>{viewer.displayName ?? viewer.email}</strong>
            <span>{viewer.email}{viewer.accountEmail && viewer.accountEmail !== viewer.email ? ` \u00b7 account ${viewer.accountEmail}` : ""}</span>
          </div>
          <span className={`settings-role-badge is-${viewer.role ?? "none"}`}>{viewer.role ?? "no access"}</span>
          <a className="settings-signout" href={signOutPath}>Sign out</a>
        </div>
        <ul className="settings-identity-list">
          <li><span className="settings-member-email">{viewer.accountEmail}</span><span className="settings-provider">primary</span></li>
          {viewer.links.map((link) => <li key={link.email}>
            <span className="settings-member-email">{link.email}</span>
            <span className="settings-provider">{link.provider ? PROVIDER_LABEL[link.provider] ?? link.provider : "linked"}</span>
            <button type="button" className="settings-remove" disabled={busy} aria-label={`Disconnect ${link.email}`} title="Disconnect this sign-in"
              onClick={async () => {
                setBusy(true);
                try {
                  await fetch("/api/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unlink", email: link.email }) });
                } finally {
                  window.location.reload();
                }
              }}>×</button>
          </li>)}
        </ul>
        {(!viewer.connectedProviders.includes("apple") || (googleSignInPath && !viewer.connectedProviders.includes("google"))) && <div className="settings-signin-row">
          {!viewer.connectedProviders.includes("apple") && <a className="settings-signin" href={`${appleSignInPath}&link=1`}> Link an Apple sign-in</a>}
          {googleSignInPath && !viewer.connectedProviders.includes("google") && <a className="settings-signin is-google" href={`${googleSignInPath}&link=1`}><span aria-hidden="true">G</span> Link a Google sign-in</a>}
        </div>}
      </div>}

      {viewer.signedIn && viewer.role === null && <div className="settings-card">
        <p>Your account is signed in but not on the member list yet. Ask a site admin to add <strong>{viewer.email}</strong> below.</p>
      </div>}

      {viewer.signedIn && viewer.role === "canView" && <div className="settings-card">
        <p>You can browse the archive. Editing the family records needs the editor role, which a site admin can grant on this page.</p>
      </div>}

      {viewer.signedIn && viewer.role === "canEdit" && <div className="settings-card">
        <p>You can edit the archive — add people, correct records, and attach photos. Managing who has access is reserved for admins.</p>
      </div>}

      <div className="settings-card">
        <h2>Language</h2>
        <p className="settings-hint">The archive&rsquo;s own words — names, biographies and stories — stay in the language they were written in.</p>
        <div className="settings-languages">
          {LANGUAGES.map((code) => <button type="button" key={code}
            className={`settings-language ${currentLang === code ? "is-active" : ""}`}
            lang={code} dir={code === "fa" ? "rtl" : "ltr"}
            onClick={() => {
              document.cookie = `${LANG_COOKIE}=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
              window.location.reload();
            }}>{LANGUAGE_NAMES[code]}</button>)}
        </div>
      </div>

      {viewer.signedIn && viewer.role !== null && <div className="settings-card">
        <h2>Connected assistants</h2>
        <p className="settings-hint">Your AI can use this archive as a tool. In Claude, ChatGPT, or any MCP client, add a connector with the address below and approve; assistants read with your access, and proposed additions wait for an editor. Disconnecting ends that assistant&rsquo;s access immediately.</p>
        <p><code>{mcpUrl}</code></p>
        {connections.length === 0 && <p className="settings-hint">Nothing is connected for you yet.</p>}
        {connections.map((connection) => <div className="settings-identity-row" key={connection.id}>
          <span><strong>{connection.clientName}</strong> · {connection.scope === "propose" ? "reads and proposes" : "read-only"} · connected {new Date(connection.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{connection.lastUsedAt ? `, last used ${new Date(connection.lastUsedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>
          <button type="button" className="settings-unlink" onClick={async () => {
            const response = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokenId: connection.id }) });
            if (response.ok) setConnections((current) => current.filter((candidate) => candidate.id !== connection.id));
          }}>Disconnect</button>
        </div>)}
      </div>}

      <div className="settings-card">
        <h2>Try a safe sample</h2>
        <p className="settings-hint">Explore importing, panning, opening records, undoing, and resetting with invented people. The sample never touches this family archive.</p>
        <a className="settings-link-card" href="/demo"><strong>Open the interactive demo</strong><span>No sign-in and no real family data.</span></a>
      </div>

      {(viewer.role === "admin" || viewer.role === "canEdit") && <div className="settings-card">
        <h2>The archive behind the archive</h2>
        <p className="settings-hint">Where the records came from, and what has been done to them.</p>
        <div className="settings-links">
          <a className="settings-link-card" href="/documents"><strong>Documents</strong><span>The family biography, the histories, and the source archive the records were read out of.</span></a>
          <a className="settings-link-card" href="/history"><strong>History</strong><span>Every change anyone has made, newest first.</span></a>
          <a className="settings-link-card" href="/api/export"><strong>Export</strong><span>The whole archive as a GEDCOM file, which every genealogy program reads.</span></a>
          <a className="settings-link-card" href="/api/digest?format=html"><strong>This week</strong><span>What changed, and whose anniversaries fall in the coming week.</span></a>
        </div>
      </div>}

      {viewer.role === "admin" && <div className="settings-card">
        <h2>Members &amp; access</h2>
        {visibility && <div className="settings-visibility">
          {([["public", "Anyone can visit", "The tree is open to anyone with the link."],
             ["password", "Anyone with the password", "Family who have the link enter a shared password once, and their browser remembers it. People on the list below are never asked."],
             ["members", "Only people I add", "Visitors must sign in, and only the people listed below can see the archive."]] as const).map(([value, label, detail]) =>
            <button type="button" key={value} className={`settings-visibility-option ${visibility === value ? "is-active" : ""}`} disabled={busy}
              onClick={async () => {
                if (visibility === value) return;
                setBusy(true);
                setNotice("");
                try {
                  const response = await fetch("/api/site", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: value }) });
                  const data = await response.json() as { visibility?: "public" | "members" | "password"; error?: string };
                  if (data.visibility) { setVisibility(data.visibility); setAccess({ hasPassword: Boolean((data as { hasPassword?: boolean }).hasPassword), shareUrl: (data as { shareUrl?: string | null }).shareUrl ?? null }); }
                  else setNotice(data.error === "set_a_password_first" ? "Set a password first — the archive cannot be locked without one." : "The change could not be saved.");
                } catch {
                  setNotice("The change could not be saved.");
                } finally {
                  setBusy(false);
                }
              }}>
              <strong>{label}</strong>
              <span>{detail}</span>
            </button>)}
        </div>}
        {visibility === "password" && <div className="settings-access">
          <label className="settings-access-row">
            <span>{access.hasPassword ? "Change the family password" : "Set a family password"}</span>
            <input type="password" value={password} placeholder="At least six characters" autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          </label>
          <div className="settings-access-actions">
            <button type="button" disabled={busy || password.trim().length < 6} onClick={() => accessAction({ action: "set_password", password: password.trim() })}>Save password</button>
            {access.hasPassword && <button type="button" className="fill-skip" disabled={busy} onClick={() => accessAction({ action: "clear_password" })}>Remove it</button>}
          </div>
          {access.shareUrl && <p className="settings-hint settings-share">
            <span>Private link — anyone who follows it is let straight in:</span>
            <code>{access.shareUrl}</code>
            <button type="button" className="fill-skip" onClick={() => {
              // composed here rather than held in state: the origin is only
              // knowable in the browser, and rendering it would not match
              // what the server sent
              void navigator.clipboard?.writeText(`${window.location.origin}${access.shareUrl}`)
                .then(() => setNotice("Private link copied.")).catch(() => setNotice("Could not copy — select the link instead."));
            }}>Copy</button>
            <button type="button" className="fill-skip" disabled={busy} onClick={() => accessAction({ action: "new_link" })}>Make a new one</button>
          </p>}
        </div>}
        <p className="settings-hint">canView can browse the archive, canEdit can change the family records, admin manages everything. New members start at canView.</p>
        {notice && <p className="settings-error">{notice}</p>}
        {!members && <p className="settings-hint">Loading the member list…</p>}
        {members && <ul className="settings-members">
          {[...members].sort((a, b) => (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) || a.email.localeCompare(b.email)).map((member) => <li key={member.email}>
            <span className="settings-member-email">
              {member.email}{member.email === viewer.accountEmail ? <em> · you</em> : null}
              {member.links.length > 0 && <span className="settings-member-links">
                {member.links.map((link) => <span key={link.email} className="settings-member-link">↪ {link.email}{link.provider ? ` (${PROVIDER_LABEL[link.provider] ?? link.provider})` : ""}
                  <button type="button" className="settings-unlink" disabled={busy} aria-label={`Unlink ${link.email}`} title="Unlink this sign-in" onClick={() => mutate({ action: "unlink", email: link.email })}>×</button>
                </span>)}
              </span>}
            </span>
            <select value={member.role} disabled={busy} aria-label={`Role for ${member.email}`}
              onChange={(event) => mutate({ action: "set", email: member.email, role: event.target.value })}>
              <option value="canView">canView</option>
              <option value="canEdit">canEdit</option>
              <option value="admin">admin</option>
            </select>
            <button type="button" className="settings-remove" disabled={busy} aria-label={`Remove ${member.email}`}
              onClick={() => mutate({ action: "remove", email: member.email })}>×</button>
          </li>)}
        </ul>}
        <form className="settings-add" onSubmit={(event) => { event.preventDefault(); if (newEmail.trim()) mutate({ action: "set", email: newEmail.trim().toLowerCase(), role: newRole }); }}>
          <input type="email" required placeholder="name@example.com" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} aria-label="Email address to add" />
          <select value={newRole} onChange={(event) => setNewRole(event.target.value === "admin" ? "admin" : event.target.value === "canEdit" ? "canEdit" : "canView")} aria-label="Role for the new member">
            <option value="canView">canView</option>
            <option value="canEdit">canEdit</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" disabled={busy || !newEmail.trim()}>Add member</button>
        </form>
      </div>}
    </section>
  </main>;
}
