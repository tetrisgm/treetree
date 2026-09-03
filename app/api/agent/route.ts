import { modelClient, modelConfigured, modelName } from "../../../lib/model";
import { Buffer } from "node:buffer";
import { strFromU8 } from "fflate";
import { requireEditor } from "../../authz";
import { cookies } from "next/headers";
import { LANGUAGE_ENDONYM, LANG_COOKIE, parseLang } from "../../../lib/i18n";
import { getMemberPerson, listAttachments, readTree, recordAgentQuestions, saveAttachment } from "../../../db/store";
import { intentContext } from "../../../lib/family-answers";
import { extractEvidenceUrls, fetchWebEvidence } from "../../../lib/web-evidence";
import { extractArchive } from "../../../lib/archive-import";
import { reconcileProposals } from "../../../lib/agent-reconcile";
import { familyFactoids, onThisDay } from "../../../lib/family-facts";
import { archiveQueryRelationships } from "../../../lib/archive-query-context";
import { interviewLeads } from "../../../lib/interview";
import { archivistInstructions, archivistTools } from "../../../lib/archivist";
import { conflictFromCall, proposalFromCall, uiActionFromCall, type AgentUiAction } from "../../../lib/agent-calls";
import { MAX_UPLOAD_MANIFEST_CHARS, requestExceedsUploadEnvelope, validateUploadBatch } from "../../../lib/upload-policy";
import type { AgentConflict, Attachment, ChangeProposal, FamilyTree } from "../../../lib/types";
import { parseGedcom } from "../../../lib/gedcom-import";

export const runtime = "edge";

const MAX_ARCHIVE_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_EXTRACTED_BYTES = 30 * 1024 * 1024;
const MAX_ARCHIVE_TEXT_CHARS = 1_000_000;
const MAX_ARCHIVE_IMAGES = 40;
const MAX_MESSAGE_CHARS = 8_000;


type ToolCall = { type: "function_call"; name: string; arguments: string };

/** Relationships are graph facts, so they are computed and handed over rather
 * than left to the model; the interview leads are the gaps near whoever is
 * being discussed, which is the only place a living relative can actually
 * help. */
function archivistContext(tree: FamilyTree, conversation: string, egoId: string | null): string {
  const { people, relationships } = archiveQueryRelationships(tree, conversation);
  const leads = interviewLeads(tree, people.map((person) => person.id));
  const today = onThisDay(tree).map((fact) => fact.text);
  return [
    relationships.length ? `Computed relationships (authoritative):\n${relationships.join("\n")}` : "",
    // the intent layer: who this editor is in the tree and their kinship to
    // everyone mentioned, year snapshots, origins - computed, never derived
    intentContext(tree, conversation, egoId),
    leads.length ? `Worth asking about (gaps near the people in this conversation):\n${leads.map((lead) => `- ${lead.personName}${lead.nearTo ? ` (near ${lead.nearTo})` : ""}: missing ${lead.missing.join(", ")}`).join("\n")}` : "",
    today.length ? `Anniversaries today:\n${today.join("\n")}` : "",
    `Facts about the archive:\n${familyFactoids(tree).map((fact) => fact.text).join("\n")}`,
  ].filter(Boolean).join("\n\n") + "\n\n";
}


export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  if (!modelConfigured()) return Response.json({ error: "openai_not_configured" }, { status: 503 });
  if (requestExceedsUploadEnvelope(request.headers)) return Response.json({ error: "files_too_large" }, { status: 413 });

  // a request that is not multipart throws here, outside the try below, and
  // used to surface as an empty 500 with nothing to read
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected_form_data" }, { status: 400 });
  const message = String(form.get("message") ?? "").trim().slice(0, MAX_MESSAGE_CHARS);
  const history = String(form.get("history") ?? "").slice(0, 16_000);
  const manifest = String(form.get("file_manifest") ?? "").slice(0, MAX_UPLOAD_MANIFEST_CHARS);
  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (!message && files.length === 0) return Response.json({ error: "empty_message" }, { status: 400 });
  const uploadError = validateUploadBatch(files);
  if (uploadError) return Response.json({ error: uploadError }, { status: 413 });
  const [tree, existingAttachments, egoId] = await Promise.all([readTree(), listAttachments(), getMemberPerson(auth.user.email)]);
  // the archive is multilingual and so is the reader
  const readerLanguage = LANGUAGE_ENDONYM[parseLang((await cookies()).get(LANG_COOKIE)?.value)];
  const stored: Attachment[] = [];
  const deterministicProposals: ChangeProposal[] = [];
  for (const file of files) stored.push(await saveAttachment(file, auth.user.email));
  // pasted links become evidence: the page is fetched, snapshotted as a
  // text attachment (so the citation survives link rot), and read like any
  // uploaded document
  const webEvidence: string[] = [];
  for (const url of extractEvidenceUrls(message)) {
    const fetched = await fetchWebEvidence(url);
    if ("error" in fetched) { webEvidence.push(`The link ${url} could not be used as evidence: ${fetched.error}.`); continue; }
    const snapshot = `Source: ${fetched.url}\nSaved: ${new Date().toISOString()}\nTitle: ${fetched.title}\n\n${fetched.text}`;
    const filename = `web-${new URL(fetched.url).hostname}-${Date.now()}.txt`;
    stored.push(await saveAttachment(new File([snapshot], filename, { type: "text/plain" }), auth.user.email));
    webEvidence.push(`Snapshot of ${fetched.url} ("${fetched.title}"), preserved as evidence ${filename}:\n${fetched.text.slice(0, 30_000)}`);
  }
  const content: Array<Record<string, unknown>> = [{
    type: "input_text",
    text: `${message || "Please examine the attached material."}\n\nRecent conversation:\n${history || "(none)"}\n\nFolder/file manifest (paths preserve recursive folder structure):\n${manifest || "(none)"}\n\n${webEvidence.length ? `Linked web pages (fetched and preserved as evidence):\n${webEvidence.join("\n\n")}\n\n` : ""}${archivistContext(tree, `${message} ${history}`, egoId)}Current tree JSON:\n${JSON.stringify(tree)}\n\nExisting private attachment metadata:\n${JSON.stringify(existingAttachments)}\n\nNew uploaded evidence IDs:\n${JSON.stringify(stored)}`,
  }];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      try {
        const report = extractArchive(new Uint8Array(await file.arrayBuffer()), { entryBytes: MAX_ARCHIVE_ENTRY_BYTES, totalBytes: MAX_ARCHIVE_EXTRACTED_BYTES, entries: 500 });
        let textChars = 0;
        let imageCount = 0;
        let omittedTextEntries = 0;
        let omittedImageEntries = 0;
        for (const entry of report.entries) {
          const { path, bytes, kind } = entry;
          if (kind === "text") {
            const remaining = MAX_ARCHIVE_TEXT_CHARS - textChars;
            if (remaining <= 0) { omittedTextEntries += 1; continue; }
            const decoded = strFromU8(bytes);
            if (/\.(?:ged|gedcom)$/i.test(path)) {
              const gedcom = parseGedcom(decoded);
              deterministicProposals.push(...gedcom.proposals);
              content.push({ type: "input_text", text: `Deterministic GEDCOM report for ${file.name}/${path}: ${gedcom.people} people, ${gedcom.families} families, ${gedcom.relationships} relationships, ${gedcom.warnings.length} warnings. These structured records are already queued as proposals; do not emit duplicate person or relationship tools for them.` });
              continue;
            }
            const allowed = Math.min(120_000, remaining);
            const extracted = decoded.slice(0, allowed);
            if (decoded.length > allowed) omittedTextEntries += 1;
            textChars += extracted.length;
            content.push({ type: "input_text", text: `Extracted from ${file.name}/${path}:\n${extracted}` });
          } else {
            if (imageCount >= MAX_ARCHIVE_IMAGES) { omittedImageEntries += 1; continue; }
            imageCount += 1;
            const mime = entry.contentType;
            const embedded = await saveAttachment(new File([bytes as unknown as BlobPart], path, { type: mime }), auth.user.email);
            stored.push(embedded);
            content.push({ type: "input_text", text: `Embedded image ${file.name}/${path} was preserved as attachment ID ${embedded.id}. Use that ID as a portrait only if the archive explicitly links this image to a person.` });
            content.push({ type: "input_image", image_url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`, detail: "high" });
          }
        }
        if (report.skippedTotal || omittedTextEntries || omittedImageEntries) {
          const reasons = Object.entries(report.skippedCounts).map(([reason, count]) => `${count} ${reason.replaceAll("_", " ")}`).join(", ");
          const incomplete = report.truncated || omittedTextEntries > 0 || omittedImageEntries > 0;
          content.push({
            type: "input_text",
            text: `Archive processing note for ${file.name}: ${report.entries.length} supported entries were selected; ${report.skippedTotal} entries were ignored${reasons ? ` (${reasons})` : ""}; ${omittedTextEntries} selected text entries and ${omittedImageEntries} selected images could not fit in this request.${incomplete ? " This request did not examine every supported archive resource, so do not describe it as a complete import." : " All supported archive resources fit in this request."}`,
          });
        }
      } catch { content.push({ type: "input_text", text: `The uploaded ZIP ${file.name} could not be unpacked; use its filename as evidence only.` }); }
      continue;
    }
    if (/\.(?:ged|gedcom)$/i.test(file.name)) {
      const gedcom = parseGedcom(new TextDecoder().decode(await file.arrayBuffer()));
      deterministicProposals.push(...gedcom.proposals);
      content.push({ type: "input_text", text: `Deterministic GEDCOM report for ${file.name}: ${gedcom.people} people, ${gedcom.families} families, ${gedcom.relationships} relationships, ${gedcom.warnings.length} warnings. These structured records are already queued as proposals; do not emit duplicate person or relationship tools for them.` });
      continue;
    }
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const contentType = file.type || "application/octet-stream";
    const dataUrl = `data:${contentType};base64,${base64}`;
    content.push(contentType.startsWith("image/")
      ? { type: "input_image", image_url: dataUrl, detail: "high" }
      : /\.(pdf|docx|xlsx|csv|txt|md|html?|json|xml)$/i.test(file.name)
        ? { type: "input_file", filename: file.name, file_data: dataUrl, detail: "high" }
        : { type: "input_text", text: `Uploaded evidence file ${file.name} (${contentType}, ${file.size} bytes) was preserved, but its binary format cannot be read directly.` });
  }

  const openai = modelClient();
  try {
    const response = await openai.responses.create({
      model: modelName(),
      instructions: archivistInstructions(readerLanguage),
      input: [{ role: "user", content }] as never,
      tools: archivistTools as never,
      parallel_tool_calls: true,
      safety_identifier: `editor_${auth.user.subject}`,
      store: false,
    });
    const calls = response.output.filter((item): item is typeof item & ToolCall => item.type === "function_call");
    const rawProposals = calls
      .map((item) => proposalFromCall(item))
      .filter((item): item is ChangeProposal => item !== null);
    const explicitConflicts = calls.map((item) => conflictFromCall(item)).filter((item): item is AgentConflict => item !== null);
    const uiActions = calls.map((item) => uiActionFromCall(item)).filter((item): item is AgentUiAction => item !== null).slice(0, 4);
    const reconciled = reconcileProposals(tree, [...deterministicProposals, ...rawProposals]);
    const conflicts = [...explicitConflicts, ...reconciled.conflicts];
    // What reading the material raised but could not settle belongs in the
    // Fill-in tab, where the family can answer it, rather than only in a chat
    // reply that scrolls away.
    await recordAgentQuestions(conflicts, auth.user.email);
    const reply = response.output_text.trim() || (conflicts.length
      ? conflicts.map((conflict) => conflict.question).join("\n\n")
      : reconciled.proposals.length
        ? `I found and applied ${reconciled.proposals.length === 1 ? "one update" : `${reconciled.proposals.length} updates`}.`
        : uiActions.length
          ? "There you go — it's on screen."
          : "I could not find a concrete change to make yet.");
    return Response.json({ reply, proposals: reconciled.proposals, conflicts, attachments: stored, uiActions });
  } catch (error) {
    console.warn("Family archivist request failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "agent_failed" }, { status: 502 });
  }
}
