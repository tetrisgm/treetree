"use client";

import { useState } from "react";

/** What a family member sees when the archive is behind the shared password.
 *
 * The password goes to the server and nothing comes back but a yes or a no;
 * on yes the server sets the cookie that remembers this browser, and the
 * page reloads into the archive. */
export default function PasswordGate() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/access", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) { window.location.replace("/"); return; }
      setError(response.status === 401 ? "That is not the password." : "Something went wrong. Please try again.");
    } catch {
      setError("Could not reach the archive. Please try again.");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <div className="settings-card">
      <p>This archive is kept for the family. Enter the password you were given and this browser will remember it.</p>
      <form className="gate-form" onSubmit={submit}>
        <input
          type="password" autoFocus required value={password} placeholder="Password"
          autoComplete="current-password" aria-label="Family password"
          onChange={(event) => { setPassword(event.target.value); setError(""); }}
        />
        <button type="submit" disabled={busy || !password}>{busy ? "Checking…" : "Enter"}</button>
      </form>
      {error && <p className="gate-error" role="alert">{error}</p>}
      <p className="gate-note">On the member list instead? <a href="/settings">Sign in</a>.</p>
    </div>
  );
}
