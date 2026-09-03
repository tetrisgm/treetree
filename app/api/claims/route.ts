import { listEvidenceClaims, setEvidenceClaimStatus } from "../../../db/store";
import { requireEditor } from "../../authz";
import { preventSharedCaching, privateJsonResponse } from "../../../lib/archive-cache";

export const runtime = "edge";

export async function GET(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  const url = new URL(request.url);
  const subjectType = url.searchParams.get("subjectType");
  const subjectId = url.searchParams.get("subjectId")?.trim();
  if ((subjectType !== "person" && subjectType !== "relationship") || !subjectId) {
    return privateJsonResponse({ error: "invalid_claim_subject" }, { status: 400 });
  }
  return privateJsonResponse({ claims: await listEvidenceClaims(subjectType, subjectId) });
}

export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  let body: { claimId?: unknown; status?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return privateJsonResponse({ error: "invalid_json" }, { status: 400 }); }
  const claimId = typeof body.claimId === "string" ? body.claimId.trim() : "";
  if (!claimId || (body.status !== "preferred" && body.status !== "rejected")) {
    return privateJsonResponse({ error: "invalid_claim_status" }, { status: 400 });
  }
  try {
    return privateJsonResponse({ claims: await setEvidenceClaimStatus(claimId, body.status, auth.user.email) });
  } catch (error) {
    return privateJsonResponse({ error: error instanceof Error ? error.message : "claim_update_failed" }, { status: 400 });
  }
}
