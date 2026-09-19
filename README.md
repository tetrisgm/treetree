# TreeTree

A self-hosted family archive with an AI archivist, source evidence,
reversible changes, and interactive family trees. One deployment holds one
family's archive on a Cloudflare Worker, D1 database and R2 bucket.

This public repository includes an entirely fictional dataset and examples
you can use in demos, tests and your own projects under the [MIT license](LICENSE).

## Try the live demo

**[Open the sandbox](https://treetree.app/demo)** — no sign-in or AI key.
Load twelve invented people across four generations, add an example relative,
inspect a record, undo a change and download the GEDCOM. Changes stay in your
browser tab and disappear on reset or reload.

For the full archive experience, [explore the Everfield family](https://treetree.app):
switch between family, tree, list, timeline, calendar and map views, or ask
how two people are related. This is a separate synthetic showcase; public
visitors can read and ask questions, while edits happen in the sandbox.
AI chat is rate-limited and can be temporarily unavailable. The sandbox's
buttons and WebMCP tools work without a model call.

## Run the same sandbox locally

Use Node.js 22.13 or newer:

```sh
git clone https://github.com/tetrisgm/treetree.git
cd treetree
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [localhost:5173/demo](http://localhost:5173/demo), then click
**Load sample GEDCOM**. Explore twelve invented people across four
generations, click **Add example relative**, select a record, undo, or reset.
Download the same GEDCOM directly from the page.

The sandbox needs **no Cloudflare account, AI key or sign-in**. It parses a
real GEDCOM file and keeps changes in browser memory. It does not seed or
modify an archive. The root archive page requires deployment configuration;
start at `/demo` for the configuration-free trial.

[Examples and walkthrough](examples/README.md) include the family file, a
fictional interview, a letter with conflicting evidence, and prompts with
expected outcomes. Everyone and every event in these examples is invented;
they are not anonymized private records.

## What you can do

- Explore a family through pedigree, tree, fan, list, timeline, calendar and
  map views, with multilingual records and interface translations.
- Import GEDCOM 5.5.1/7 files, documents and interviews; review conflicting
  evidence and keep sources attached to claims.
- Work with an AI archivist, review change history and undo changes.
- Export GEDCOM so names, relationships and notes remain portable.
- Connect a browser agent through WebMCP or a remote assistant through MCP.

The full archive needs an owner and storage bindings. AI chat and document
extraction need a provider key; the standalone sandbox does not.

## Deploy your own archive

Use a fresh checkout for a **new** deployment. Install dependencies with
`npm ci`, sign in to your Cloudflare account, then run:

```sh
npx wrangler login
node scripts/setup.mjs --name my-family-tree --owner you@example.com --archive-name "My Family"
```

Replace the example owner address with yours. The setup script provisions
or reuses D1/R2 resources, updates `wrangler.jsonc`, builds and deploys the
Worker, creates the session secret, and prints a private bootstrap sign-in
link. It does not import the synthetic dataset. Do not rerun setup to update
an existing deployment: it replaces the session secret. Use `npm run deploy`
for later application updates.

Open the bootstrap link to become the first admin. Under **Settings →
Members & access**, choose members-only or password access before adding
private records. Visibility must be configured explicitly; do not assume
a new archive is private. For a disposable demonstration archive, import
[the sample file](examples/rowan-family.ged) using the
[walkthrough](examples/README.md#try-document-evidence-in-your-own-test-archive).

Configure AI with one of the supported providers:

```sh
npx wrangler secret put OPENAI_API_KEY
# Or:
npx wrangler secret put ANTHROPIC_API_KEY
```

Enter the key at the prompt. Optional Worker vars are `OPENAI_MODEL` or
`ANTHROPIC_MODEL`; `MODEL_PROVIDER` selects `openai` or `anthropic` if both
keys exist. Without a key the archive can display records, but AI routes
return 503. Even GEDCOM uploads through the archivist chat require a key
for that surrounding workflow.

For family members to sign in, configure Google or Apple OAuth with the
callback `<PUBLIC_ORIGIN>/api/auth/google/callback` or
`<PUBLIC_ORIGIN>/api/auth/apple/callback`. Google uses `GOOGLE_CLIENT_ID`
and the `GOOGLE_CLIENT_SECRET` secret. Apple uses `APPLE_CLIENT_ID`,
`APPLE_TEAM_ID`, `APPLE_KEY_ID` and the `APPLE_PRIVATE_KEY` secret. The
bootstrap link retires when the owner links a provider. Privacy and terms
pages are served at `/privacy` and `/terms`.

Deployment identity and naming live in `wrangler.jsonc`: `PUBLIC_ORIGIN`,
`OWNER_EMAIL`, `ARCHIVE_NAME`, `ARCHIVE_TAGLINE`, optional
`ARCHIVE_NAME_<LANG>` and `ARCHIVE_PROMPT_CONTEXT`. Keep credentials in
Worker secrets or ignored local environment files.

## Browser agents and remote assistants

With a WebMCP-enabled browser, the sandbox exposes `list_family`,
`add_person`, `link_parent`, `link_marriage`, `import_sample_gedcom`,
`undo`, `reset_sandbox` and `what_can_i_do_here`. Ask the browser's agent:

> Import the sample GEDCOM. Add Iris Rowan, born 1980, and make Maya Rowan
> her mother. Then undo the parent link.

The archive's tools can answer relationship questions and move its live
canvas. Tools register on available `document.modelContext` and
`navigator.modelContext` surfaces; browser support varies. Buttons and tree
navigation also work without an agent.

A remote MCP client connects to `https://<your-archive>/api/mcp` and uses
OAuth to request a member's access. Read tools follow that member's
permissions; propose-scope tools queue changes for editor review. See
[the OAuth/MCP test harness](scripts/test-oauth-mcp-loop.py) for an optional
integration check against your own deployment.

## Develop and verify

```sh
npm run dev
npm run gate  # unit/integration tests, typecheck, lint and production build
```

Run the gate on your development machine before pushing. Browser acceptance
checks can be performed locally at `/demo`: load, select, undo, reset and
download. There is no `test:browser` script and no production browser test
suite. The fixture tests also verify that GEDCOM export and re-import
preserve the sample's people and relationships.

## Scope and limits

- One deployment is one family; this is not a multi-tenant service.
- Anonymous living-person redaction preserves names, birth years and graph
  relationships. It hides precise dates, places, biographies and photos for
  people classified as likely living. Undated people are not automatically
  classified as living. Use access controls for private archives.
- The sandbox is a deterministic interaction demo. Evidence review and AI
  document extraction run in a configured archive and may produce different
  wording or proposals each time.
- GEDCOM export carries people, relationships and notes; retain separate
  backups of files, permissions and history.
- R2 snapshots and a circuit breaker provide read fallback during D1 quota
  exhaustion. Usage and hosting costs depend on your Cloudflare plan.

## License

[MIT](LICENSE), including the synthetic examples.
