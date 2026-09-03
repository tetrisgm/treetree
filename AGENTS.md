# Agent setup contract

You are setting up a self-hosted agentic family archive for the person you
are working with. Everything here is executable by a coding agent with shell
access; steps a human must click through are marked **HUMAN**. Read
`README.md` for what the product is; this file is the how.

## Set up a new archive

1. **Preconditions.** `node >= 22.13`, `npx wrangler whoami` succeeds (else
   have the human run `npx wrangler login`). Run `npm install`.
2. **Provision in one step** — creates (or reuses) the D1 database and R2
   bucket, rewrites `wrangler.jsonc` for this deployment, and sets
   `AUTH_SESSION_SECRET`:
   ```sh
   node scripts/setup.mjs --name <family>-tree --owner <their email> --archive-name "<Family>"
   ```
   Optional: `--tagline "..."`, and `--origin https://their.domain` when a
   custom zone exists (otherwise it serves from `workers.dev`). The script
   builds and deploys, corrects `PUBLIC_ORIGIN` to the real workers.dev URL,
   sets the session secret, and prints a **bootstrap sign-in link** - hand it
   to the human; it makes them admin with no OAuth console and retires once
   a real provider is linked. Ask which languages/calendars their records
   use and set `ARCHIVE_NAME_<LANG>` / `ARCHIVE_PROMPT_CONTEXT` vars
   accordingly. The manual equivalent is in `README.md`.
3. **`OPENAI_API_KEY`**: ask the human for a key (never echo it; pipe it to
   `npx wrangler secret put OPENAI_API_KEY --name <worker>`). Without it the
   site deploys fine and AI features return 503, so this can wait.
4. **Sign-in providers.** **HUMAN** — these need developer-console clicks:
   - Google: create an OAuth client (web) in Google Cloud Console with
     redirect URI `<PUBLIC_ORIGIN>/api/auth/google/callback`; set the
     `GOOGLE_CLIENT_ID` var and `GOOGLE_CLIENT_SECRET` secret. To publish
     past test mode, Google requires privacy-policy and terms links — this
     app serves them at `/privacy` and `/terms`.
   - Apple (optional): a Services ID, key, and team ID; callback
     `<PUBLIC_ORIGIN>/api/auth/apple/callback`; vars
     `APPLE_CLIENT_ID`/`APPLE_TEAM_ID`/`APPLE_KEY_ID`, secret `APPLE_PRIVATE_KEY`.
   At least one provider must be configured or nobody can sign in.
5. **Deploy and verify.**
   ```sh
   npm run deploy
   curl -fsS <PUBLIC_ORIGIN>/api/version     # {"version":...} proves the Worker is up
   ```
   The schema self-creates at first request; there is no migration step.
6. **First sign-in.** **HUMAN** signs in with the `OWNER_EMAIL` account and
   lands as admin. Offer to walk them through Settings → Members & access
   (visibility: public / members / password) and their first GEDCOM import
   or archivist conversation.

## Working on the code

- Run `npm run gate` (tests, typecheck, lint, build) before any push; lint
  and typecheck are separate gates because `npm run build` runs neither.
- `npm run test:browser` targets the deployed site; set `PLAYWRIGHT_BASE_URL`
  to test elsewhere. It needs a member session — see the note at the top of
  `tests/browser/public-tree.spec.ts`.
- Deployment identity: bump `VERSION`/`BUILD_ID` in `lib/build.ts` with each
  production release; `/api/version` and the page corner expose it uncached.
- The store keeps the archive readable through D1 daily-read-quota
  exhaustion via R2 snapshots (`system/*` objects) and a per-isolate circuit
  breaker (`db/store.ts`). Never write those snapshot objects by hand with a
  shell that appends a newline; `lib/tree-snapshot.ts` documents the shapes.
