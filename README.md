# Agentic family tree

A self-hosted family archive where an AI archivist is the primary way the
family records itself. Members talk to it, hand it documents, photographs,
GEDCOM exports, or scanned letters, and it builds a provenanced genealogy:
every fact can carry a source, conflicting sources become durable disputed
claims a person adjudicates, every mutation is audited and reversible, and
likely-living people are redacted from public view.

**Live demo:** <https://family-archive-demo.ramine-4e9.workers.dev> — the
invented Everfield family. Every person is synthetic, the archive is public,
and no AI key is attached (the chat politely declines; tree, views, GEDCOM
import, and both MCP surfaces are fully live). Every real deployment is the
opposite: one Worker, one family, private by default, theirs alone. Each
instance also serves its own `/demo` sandbox with invented people.

## What's inside

- **Next.js (vinext) on a Cloudflare Worker** — one Worker, one D1 database,
  one R2 bucket per family. No servers.
- **The archivist** — chat with full create/read/update/delete tools over the
  tree, document ingestion with a durable queue, an interviewer mode that asks
  the family about gaps, and claim-level evidence with dispute adjudication.
- **A living canvas** — pedigree, fan, list, timeline, calendar, and map views
  over the same graph, in multiple languages.
- **GEDCOM 5.5.1/7 in and out** — deterministic parsing (including inside
  ZIP/GEDZip), and a one-click export so the family's data is never captive.
- **Quota resilience** — R2 snapshots plus a circuit breaker keep the archive
  readable through Cloudflare D1 free-tier daily-read exhaustion.

## Deploy your own

The fastest path: open this repo with a coding agent (Claude Code, Codex,
Cursor) and say **"set up my family archive"** — [AGENTS.md](AGENTS.md) is the
setup contract it will follow. By hand, the same steps are:

1. **Provision** (needs a Cloudflare account and `wrangler` logged in):
   ```sh
   npx wrangler d1 create my-family
   npx wrangler r2 bucket create my-family-files
   ```
2. **Configure `wrangler.jsonc`**: set `name`, the D1 `database_name`/`database_id`
   and R2 `bucket_name` from step 1, delete the `routes` block to serve from
   `workers.dev` (or point it at your own zone), and set the `vars`:
   - `PUBLIC_ORIGIN` — your deployed URL
   - `OWNER_EMAIL` — you; seeded as the first admin when the empty database
     starts (startup refuses to run without it)
   - `ARCHIVE_NAME`, `ARCHIVE_TAGLINE` — your family's name and one line about it
   - `ARCHIVE_NAME_<LANG>` — optional per-language name (e.g. a native script)
   - `ARCHIVE_PROMPT_CONTEXT` — optional paragraph telling the archivist which
     languages, scripts, and calendars your family's records use
3. **Secrets** (`npx wrangler secret put <NAME>`; `scripts/setup.mjs` sets
   the session secret itself):
   - `AUTH_SESSION_SECRET` — any long random string; signs session cookies
   - `OPENAI_API_KEY` — powers the archivist (`OPENAI_MODEL` var to override
     the default model); without it the site works but AI features return 503
   - Optional weekly digest email: `SMTP_URL`, `MAIL_FROM`, `MAIL_REPLY_TO`
4. **Deploy**: `npm install && npm run deploy`. The database schema creates
   and migrates itself at first request — there is no migration step.
5. **Sign in with the bootstrap link** `scripts/setup.mjs` printed — no OAuth
   console needed on day one. You arrive as admin: talk to the archivist,
   import a GEDCOM, set visibility under Settings → Members & access.
6. **Real sign-in, when the family should join** (the only console step, and
   it can wait):
   - Google: OAuth client with redirect `<PUBLIC_ORIGIN>/api/auth/google/callback`
     → `GOOGLE_CLIENT_ID` var plus `GOOGLE_CLIENT_SECRET` secret
   - Apple: Services ID + key, callback `<PUBLIC_ORIGIN>/api/auth/apple/callback`
     → `APPLE_CLIENT_ID`/`APPLE_TEAM_ID`/`APPLE_KEY_ID` vars plus
     `APPLE_PRIVATE_KEY` secret
   The bootstrap link retires itself the moment the owner links a real
   provider.

## Bringing data in

Three doors, all through the chat:

- **A GEDCOM export from any other service** — Ancestry, MyHeritage, Geni,
  WikiTree, Gramps and the rest all export one (ask the archivist for the
  exact menu path for your service). Attach the `.ged` file and it is parsed
  deterministically — no model in the loop — with conflicts becoming
  questions for the family instead of silent overwrites.
- **Documents and photos** — scans, letters, PDFs, spreadsheets, whole
  folders or ZIPs. The archivist reads them, proposes changes with the
  document preserved as evidence, and files what it cannot settle as
  questions.
- **Links** — paste an https URL (an obituary, a memorial page) and the page
  is fetched, preserved as a text snapshot in evidence (so the citation
  survives link rot), and read like any document.

The fourth door is the point of the product: the family talks, and the
archivist interviews everyone toward the gaps only they can fill.

## Connect an assistant (MCP)

The archive is itself an MCP server. In Claude, ChatGPT, or any MCP client,
add a custom connector with the URL `https://<your-archive>/api/mcp` and
approve as a signed-in member; in Claude Code:

```sh
claude mcp add --transport http family-archive https://<your-archive>/api/mcp
```

Connected agents get read-only tools (people, records, relationship paths,
stories) with the approving member's access; leaving the member list revokes
their agents. `scripts/test-oauth-mcp-loop.py` is the end-to-end regression
gate for this flow - keep it passing.

## Develop

```sh
npm install
npm run dev        # local dev server
npm run gate       # tests + typecheck + lint + build — run before every push
npm run test:browser   # Playwright against the deployed site (PLAYWRIGHT_BASE_URL to override)
```

`npm run build` does **not** typecheck and `tsc` does not lint — the gate runs
all four on purpose.

## Honest limits

- One Worker is one family. There is no multi-tenancy and none is planned;
  isolation is the design.
- The Workers/D1 free tier fits a several-hundred-person archive with normal
  family traffic. The snapshot circuit breaker keeps reads alive if the D1
  daily read quota is exhausted; a busy or very large archive should use the
  paid plan.
- The archivist currently speaks OpenAI's API. Bring-your-own-provider is on
  the roadmap ([docs/PLATFORM.md](docs/PLATFORM.md)).

## License

MIT — see [LICENSE](LICENSE).
