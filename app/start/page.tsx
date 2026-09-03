import { archiveName, publicOrigin } from "../../lib/archive-config";

export function generateMetadata() {
  return {
    title: "TreeTree · The agentic family tree",
    description: "A self-hosted family archive where an AI archivist interviews your family into a provenanced tree. Talk to it, connect your agent to it, deploy your own in one command.",
  };
}

/** The product's landing page. Served by every deployment (each archive is
 * its own best advertisement), linked from the demo instance's chrome, and
 * the root of treetree.app points people here first. */
export default function StartPage() {
  const mcpUrl = `${publicOrigin()}/api/mcp`;
  return (
    <main className="settings-page">
      <section className="settings-panel">
        <p className="eyebrow settings-eyebrow">TreeTree</p>
        <h1>The family tree you can talk to.</h1>
        <div className="settings-card">
          <p>TreeTree is a self-hosted family archive where the AI archivist is the way in: it interviews your family into a provenanced tree, reads the documents and links you hand it, asks the questions only your relatives can answer — and every agent you already use can work on it too.</p>
        </div>

        <div className="settings-card">
          <h2>See it alive</h2>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full page loads on purpose */}
          <a className="settings-link-card" href="/"><strong>Open the {archiveName()} demo archive</strong><span>Four generations of invented people on a living canvas — browse, ask, explore.</span></a>
          <a className="settings-link-card" href="/demo"><strong>Build with an agent in the sandbox</strong><span>In a WebMCP browser, your agent holds create, link, import, and undo over the canvas you watch.</span></a>
        </div>

        <div className="settings-card">
          <h2>Three doors, one archive</h2>
          <p><strong>Your family</strong> talks to the in-app archivist — genesis by interview, documents and links as evidence, disputed facts adjudicated, everything undoable.</p>
          <p><strong>Your browser&rsquo;s agent</strong> gets the page&rsquo;s own WebMCP tools: it answers &ldquo;how am I related to her?&rdquo; in kinship words and points at people on the real canvas as it talks.</p>
          <p><strong>Your cloud agent</strong> (Claude, ChatGPT, anything MCP) connects with one URL and click-to-approve OAuth: <code>{mcpUrl}</code>. Reads are free within your access; writes are proposals a human editor reviews.</p>
        </div>

        <div className="settings-card">
          <h2>Deploy your own</h2>
          <p>One Worker, one family, yours alone — private by default, GEDCOM in and out so your data is never captive, MIT licensed.</p>
          <p><code>node scripts/setup.mjs --name our-tree --owner you@example.com --archive-name &ldquo;Yourfamily&rdquo;</code></p>
          <a className="settings-link-card" href="https://github.com/tetrisgm/treetree"><strong>github.com/tetrisgm/treetree</strong><span>The template, the docs for humans and for coding agents, and the whole story.</span></a>
        </div>
      </section>
    </main>
  );
}
