"use client";
import { useState } from "react";
import type { QueuedDocument } from "../../db/store";

export default function DocumentQueue({ initial }: { initial: QueuedDocument[] }) {
  const [queue, setQueue] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  async function act(id: string, action: "retry" | "cancel") {
    setBusy(id);
    try {
      const response = await fetch("/api/ingest", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) });
      const data = await response.json() as { queue?: QueuedDocument[] };
      if (response.ok && data.queue) setQueue(data.queue);
    } finally { setBusy(null); }
  }
  if (!queue.length) return null;
  return <div className="settings-card"><h2>Import activity</h2><p className="settings-hint">Structured files are parsed directly. Other documents are read in the background; failed work can be retried without uploading it again.</p>
    <ul className="document-list">{queue.map((item) => <li key={item.id}>
      <span className="document-kind">{item.status}</span><span className="document-name">{item.filename}</span>
      <span className="document-size">{item.result || (item.status === "pending" ? "Waiting" : item.status === "reading" ? "Reading…" : "")}</span>
      {item.status === "failed" && <button type="button" disabled={busy === item.id} onClick={() => act(item.id, "retry")}>Retry</button>}
      {(item.status === "pending" || item.status === "failed") && <button type="button" disabled={busy === item.id} onClick={() => act(item.id, "cancel")}>Cancel</button>}
    </li>)}</ul>
  </div>;
}
