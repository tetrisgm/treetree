"use client";

import { useEffect } from "react";

/** The demo instance's two modals: what TreeTree is (auto-opens on first
 * landing) and how to drive it with WebMCP (opened from the top pill).
 * Competition visitors skim - every line here earns its place. */
export function DemoIntro({ mode, onClose, onSwitch }: { mode: "about" | "webmcp"; onClose: () => void; onSwitch: (mode: "about" | "webmcp") => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="demo-intro-backdrop" onClick={onClose} role="presentation">
      <div className="demo-intro" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        {mode === "about" ? (
          <>
            <p className="eyebrow">TreeTree</p>
            <h2>The family tree you can talk to.</h2>
            <ul>
              <li>An AI archivist builds the tree from conversation, documents, links, and GEDCOM imports.</li>
              <li>Every fact keeps its source; conflicting sources become questions for the family; everything undoes.</li>
              <li>Your agents are users too — WebMCP tools on the page itself, hosted MCP for Claude and ChatGPT.</li>
              <li>Self-hosted and MIT: one command deploys your family&rsquo;s own private archive.</li>
              <li>The page adapts to who&rsquo;s driving: in an agentic browser the chat tucks away and the view leads — your agent is the chat.</li>
            </ul>
            <p className="demo-intro-note">This demo is the invented Everfield family — explore freely, nothing here is real.</p>
            <div className="demo-intro-actions">
              <button type="button" className="demo-intro-primary" onClick={onClose}>Explore the tree</button>
              <button type="button" onClick={() => onSwitch("webmcp")}>WebMCP guide</button>
              <a href="https://github.com/tetrisgm/treetree">GitHub</a>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">WebMCP Challenge</p>
            <h2>Drive this page with your agent.</h2>
            <p>In a WebMCP browser (Chrome 149+, or an agentic in-app browser), this page registers its tools on <code>document.modelContext</code>. Say:</p>
            <ul>
              <li>&ldquo;Where does this family come from?&rdquo;</li>
              <li>&ldquo;How is June Marlowe related to Nina Everfield?&rdquo;</li>
              <li>&ldquo;Show Rosalind on the canvas&rdquo; · &ldquo;Switch to the map&rdquo;</li>
            </ul>
            <p>In the <a href="/demo">sandbox</a>, your agent <em>creates</em> on the canvas you watch:</p>
            <ul>
              <li>&ldquo;Add Iris Rowan, born 1980, and make Maya Rowan her mother&rdquo;</li>
              <li>&ldquo;Undo that&rdquo; — either of you can undo the other</li>
            </ul>
            <p className="demo-intro-note">13 tools here, 7 in the sandbox. The chat&rsquo;s suggested prompts are this same script — click one to watch the behaviour, then say it to your agent.</p>
            <p className="demo-intro-note">And the page knows who&rsquo;s driving: when your browser exposes a model context, the chat sidebar collapses and this intro stays out of the way — your agent is the chat. The <strong>›</strong> edge control brings our chat back, and the page never re-collapses it on you.</p>
            <div className="demo-intro-actions">
              <a className="demo-intro-primary" href="/demo">Open the sandbox</a>
              <button type="button" onClick={onClose}>Explore this archive</button>
              <button type="button" onClick={() => onSwitch("about")}>What is TreeTree?</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
