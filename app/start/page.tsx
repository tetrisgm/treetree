import { archiveName, publicOrigin } from "../../lib/archive-config";

export function generateMetadata() {
  return {
    title: "TreeTree · A WebMCP demo you can drive",
    description: "A family archive where the page itself is the tool surface: your browser's agent browses, navigates, and creates on the canvas you watch. Built for the WebMCP Challenge.",
  };
}

const PROMPTS_ARCHIVE = [
  "Where does this family come from?",
  "How is June Marlowe related to Nina Everfield?",
  "Show Rosalind Everfield on the canvas.",
  "Switch to the map view.",
  "Ask the archivist what Edmund did for a living.",
];
const PROMPTS_SANDBOX = [
  "Add a person named Iris Rowan, born 1980.",
  "Make Maya Rowan her mother.",
  "Add Owen Pike, born 1978, and record his marriage to Iris.",
  "Undo that.",
  "Import the sample GEDCOM.",
];

/** The WebMCP-first landing page: a judge or tester arriving here should
 * know inside a minute what this is, how to drive it, and what to say. */
export default function StartPage() {
  const mcpUrl = `${publicOrigin()}/api/mcp`;
  return (
    <main className="settings-page">
      <section className="settings-panel">
        <p className="eyebrow settings-eyebrow">TreeTree · WebMCP demo</p>
        <h1>A family tree your agent can drive.</h1>
        <div className="settings-card">
          <p>Every capability of this site is registered on the page itself — <code>document.modelContext.registerTool()</code> and <code>navigator.modelContext</code> both — so the agent in your browser holds the same tools the interface is made of. It answers in kinship words, points at people on the live canvas while it talks, and in the sandbox it <em>creates</em>: humans and agents building the same family, each able to undo the other.</p>
        </div>

        <div className="settings-card">
          <h2>Test it in sixty seconds</h2>
          <p>Open this site in a WebMCP-enabled browser — Chrome 149+ with WebMCP enabled, or an agentic in-app browser — and talk to your agent:</p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full page loads on purpose */}
          <p><strong>On <a href="/">the {archiveName()} archive</a></strong> (12 invented people, 4 generations):</p>
          <ul>{PROMPTS_ARCHIVE.map((prompt) => <li key={prompt}><code>&ldquo;{prompt}&rdquo;</code></li>)}</ul>
          <p><strong>In <a href="/demo">the sandbox</a></strong> (no sign-in; your agent gets creation tools over the canvas you watch, and the sidebar narrates its moves):</p>
          <ul>{PROMPTS_SANDBOX.map((prompt) => <li key={prompt}><code>&ldquo;{prompt}&rdquo;</code></li>)}</ul>
          <p className="settings-hint">The archive page registers 13 tools (search, life stories, kinship, origins, year snapshots, namesakes, dates, canvas control, view switching, and a live AI archivist passthrough). The sandbox registers 7 creation tools (add, link, marry, import, list, undo, reset). Tools register on mount and unregister on unmount, per the spec.</p>
        </div>

        <div className="settings-card">
          <h2>The archivist is real</h2>
          <p>The chat on the archive page is a live AI archivist grounded in the family graph — ask it anything about the Everfields, in any language. Precomputed kinship, origins, and year snapshots are injected as authoritative context so it never invents a relationship. (Rate-limited per visitor; every person in this demo is synthetic.)</p>
        </div>

        <div className="settings-card">
          <h2>Beyond the browser: three doors, one archive</h2>
          <p>WebMCP is one of three agent doors into the same intent layer. The others: a hosted MCP server with click-to-approve OAuth for cloud agents (<code>{mcpUrl}</code>) where writes are proposals a human editor reviews, and the in-app archivist for the family itself. Same code answers all three.</p>
        </div>

        <div className="settings-card">
          <h2>Deploy your own</h2>
          <p>One Cloudflare Worker, one family, private by default, GEDCOM in and out, MIT. One command provisions, deploys, and hands you a sign-in link — no OAuth consoles on day one:</p>
          <p><code>node scripts/setup.mjs --name our-tree --owner you@example.com --archive-name &ldquo;Yourfamily&rdquo;</code></p>
          <a className="settings-link-card" href="https://github.com/tetrisgm/treetree"><strong>github.com/tetrisgm/treetree</strong><span>Source, WebMCP implementation notes, and docs written for humans and coding agents alike.</span></a>
        </div>
      </section>
    </main>
  );
}
