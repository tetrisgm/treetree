"use client";

import { useState } from "react";

export default function ProposalDecision({ proposalId }: { proposalId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const decide = async (verdict: "apply" | "reject") => {
    if (verdict === "apply" && !window.confirm("Apply this proposed change to the archive? It will be recorded in History with the agent as its source.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId, verdict }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not decide this proposal.");
      window.location.reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not decide this proposal."); setBusy(false); }
  };
  return <div className="history-undo-wrap">
    <button type="button" className="history-undo" disabled={busy} onClick={() => decide("apply")}>{busy ? "Working…" : "Apply"}</button>
    <button type="button" className="history-undo" disabled={busy} onClick={() => decide("reject")}>Reject</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}
