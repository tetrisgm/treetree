import { requireEditor } from "../../authz";
import { decideAgentProposal, listAgentProposals } from "../../../db/store";
import { preventSharedCaching, privateJsonResponse } from "../../../lib/archive-cache";

export async function GET() {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  return privateJsonResponse({ proposals: await listAgentProposals() });
}

export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  let body: { proposalId?: unknown; verdict?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
  const verdict = body.verdict === "apply" || body.verdict === "reject" ? body.verdict : null;
  if (!proposalId || !verdict) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    return Response.json(await decideAgentProposal(proposalId, verdict, auth.user.email));
  } catch (error) {
    const message = error instanceof Error ? error.message : "decision_failed";
    return Response.json({ error: message }, { status: message === "proposal_not_pending" ? 409 : 400 });
  }
}
