# Synthetic examples

All people, relationships, dates and events in these files were invented for
TreeTree. They were not exported or anonymized from a real family archive.
City names are real places so maps remain useful. The examples are covered
by the repository's [MIT license](../LICENSE); use them in demos, screenshots,
tests and your own projects. No photographs, contact details or credentials
are included.

| File | What it demonstrates |
| --- | --- |
| [rowan-family.ged](rowan-family.ged) | GEDCOM 5.5.1, UTF-8: 12 people, 5 families, 12 parent links and 5 spouse links over four generations. |
| [maya-letter.txt](maya-letter.txt) | A fictional source that disagrees with Maya's recorded birth year. |
| [family-interview.txt](family-interview.txt) | Relationships, a family story, and a question the speaker cannot answer. |

## Try the sandbox without an account

From the repository root, with Node.js 22.13 or newer:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [localhost:5173/demo](http://localhost:5173/demo). No Cloudflare login,
AI key, owner email or database seeding is needed for this page.

1. Start with Maya and Leo Rowan. Click **Load sample GEDCOM**.
2. The real GEDCOM parser loads this folder's file: **12 people and 17 links**.
   Loading replaces the current sandbox tree; it does not merge custom edits.
3. Select **Évelyn Vale** to see a deceased ancestor's biography and Bristol
   death record. Select **Alex Chen** to see a deliberately unknown birth date.
4. Click **Undo** to restore the previous tree, or **Reset** to return to
   Maya and Leo and clear the undo history. Reloading also resets everything.
5. **Download the sample GEDCOM** saves the exact file used by the sandbox.

The sandbox changes only memory in this browser tab. It never reads or writes
the archive database, calls an AI model, or stores uploads. Its activity
messages describe deterministic actions. All fictional details remain
visible here, including those of fictional living people.

In a browser with WebMCP support, ask its agent:

- “Import the sample GEDCOM.” → 12 people, 17 links.
- “List the family.” → the twelve names in the file.
- “Add Iris Rowan, born 1980, and make Maya Rowan her mother.” → a new person
  and parent link appear. Each tool action is a separate undo step.
- “Undo that.” / “Reset the sandbox.”

Ordinary browsers can use the buttons; WebMCP is optional.

## Try document evidence in your own test archive

This exercises the full product and requires a separate deployment, an
editor/admin sign-in, and a configured AI provider. Follow the
[deployment instructions](../README.md#deploy-your-own-archive). Use an empty
test archive to keep these fictional records separate from real records.

1. Attach `rowan-family.ged` in the archivist chat and ask “Import this
   fictional family.” The file parses deterministically; the surrounding
   chat workflow still requires an AI key. On an empty archive, check for
   12 people and 17 links after applying the import.
2. Ask “How is June Ortiz related to Maya Rowan?” Expected: June is Maya's
   granddaughter, through Nora. Ask “What is Alex Chen's birth date?”
   Expected: unknown; an estimated date must not become a recorded fact.
3. Attach `family-interview.txt`: “Save the story of the move to Lyon in 1986
   and cite this transcript. Leave Alex's unknown birth details blank.”
   Inspect the saved source and proposed changes.
4. Attach `maya-letter.txt`: “Compare this letter with Maya's birth year.
   Preserve the conflicting evidence and ask me before changing it.”
   The GEDCOM says **1952**; the letter implies **1953**. Review the source
   and disagreement. Model wording and extraction can vary.
5. Inspect History, undo an import/change, and export GEDCOM to check that
   the records remain portable. The export embeds stories as person notes;
   it is not a backup of attachments, permissions or the audit log.

The regular archive applies its living-person redaction rules to anonymous
visitors: for example, Nora's exact birthday, city and biography are hidden.
Names, birth years and relationships remain visible. Undated people are not
automatically classified as living, so use members-only or password access
for a real private family archive.

## Verification

`npm run gate` includes [fixture tests](../tests/demo-family.test.ts) for
parsing, cross-generation links, date precision, UTF-8, import/export
round trips, download equality, fresh sandbox state and living-person
redaction. Document extraction is an AI walkthrough, not a scripted response.
