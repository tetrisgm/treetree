import { requireEditor } from "../../authz";
import { applyProposal } from "../../../db/store";
import { isChangeProposal } from "../../../lib/change-proposal";

export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const envelope = body && typeof body === "object" && "proposal" in body ? body as {
    proposal?: unknown;
    evidenceAttachments?: Array<{ id?: unknown; filename?: unknown }>;
    assertion?: unknown;
  } : null;
  const proposal = envelope?.proposal ?? body;
  if (!isChangeProposal(proposal)) {
    return Response.json({ error: "invalid_proposal" }, { status: 400 });
  }
  try {
    const evidence = Array.isArray(envelope?.evidenceAttachments)
      ? envelope.evidenceAttachments.filter((item) => typeof item?.id === "string" && typeof item?.filename === "string").slice(0, 8)
      : [];
    const assertion = typeof envelope?.assertion === "string" ? envelope.assertion.trim().slice(0, 1_000) : "";
    const tree = await applyProposal(proposal, auth.user.email, evidence.length ? {
      sourceType: "attachment",
      sourceLabel: evidence.map((item) => String(item.filename)).join(", "),
      attachmentId: String(evidence[0].id),
      sourceExcerpt: assertion || null,
      confidence: 85,
    } : {
      sourceType: "family_assertion",
      sourceLabel: `Family member ${auth.user.email}`,
      sourceExcerpt: assertion || null,
      confidence: 100,
    });
    return Response.json({ ok: true, tree });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "change_failed" }, { status: 400 });
  }
}
