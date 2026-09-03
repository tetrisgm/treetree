"use client";

import { useState } from "react";

export default function UndoChangeButton({ changeId }: { changeId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="history-undo-wrap">
    <button type="button" className="history-undo" disabled={busy} onClick={async () => {
      if (!window.confirm("Undo this change? A new history entry will record the reversal.")) return;
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeId }) });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not undo this change.");
        window.location.reload();
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not undo this change."); setBusy(false); }
    }}>{busy ? "Undoing…" : "Undo"}</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}
