"use client";

import { useEffect, useRef } from "react";

/** The demo instance's two modals: what TreeTree is (auto-opens on first
 * landing) and how to drive it with WebMCP (opened from the top pill). */
export function DemoIntro({ mode, onClose, onSwitch }: { mode: "about" | "webmcp"; onClose: () => void; onSwitch: (mode: "about" | "webmcp") => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="demo-intro-dialog" aria-labelledby="demo-intro-heading"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
      }}>
      <div className="demo-intro">
        <button className="demo-intro-close" type="button" aria-label="Close introduction" onClick={onClose}>×</button>
        {mode === "about" ? (
          <>
            <p className="eyebrow">TreeTree</p>
            <h2 id="demo-intro-heading">The family tree you can talk to.</h2>
            <ul>
              <li>An AI archivist builds the tree from conversation, documents, links, and GEDCOM imports.</li>
              <li>Keep evidence alongside facts, review conflicting claims, and undo recorded changes.</li>
              <li>Your agents are users too — WebMCP tools on the page itself, hosted MCP for Claude and ChatGPT.</li>
              <li>Self-hosted and MIT: deploy your own archive, then choose who can access it.</li>
              <li>The page adapts to who&rsquo;s driving: in an agentic browser the chat tucks away and the view leads — your agent is the chat.</li>
            </ul>
            <p className="demo-intro-note">This demo is the invented Everfield family — explore freely, nothing here is real.</p>
            <div className="demo-intro-actions">
              <a className="demo-intro-primary" href="/demo">Try the sandbox</a>
              <button type="button" onClick={onClose}>Explore the tree</button>
              <button type="button" onClick={() => onSwitch("webmcp")}>WebMCP guide</button>
              <a href="https://github.com/tetrisgm/treetree">GitHub</a>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">Browser agents</p>
            <h2 id="demo-intro-heading">Drive this page with your agent.</h2>
            <p>In a browser whose agent supports WebMCP, ask:</p>
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
            <p className="demo-intro-note">Ordinary browsers work too. The sandbox has buttons to load a family, add an example relative, undo and reset. No account or AI key is needed.</p>
            <p className="demo-intro-note">And the page knows who&rsquo;s driving: when your browser exposes a model context, the chat sidebar collapses and this intro stays out of the way — your agent is the chat. The <strong>›</strong> edge control brings our chat back, and the page never re-collapses it on you.</p>
            <div className="demo-intro-actions">
              <a className="demo-intro-primary" href="/demo">Open the sandbox</a>
              <button type="button" onClick={onClose}>Explore this archive</button>
              <button type="button" onClick={() => onSwitch("about")}>What is TreeTree?</button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
