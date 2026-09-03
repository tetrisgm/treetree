// A member's own MCP connections: list them, end one. Members manage only
// their own; removing someone from the member list ends theirs implicitly.
import { getAppleUser } from "../../apple-auth";
import { getViewerRole } from "../../authz";
import { listAgentConnections, resolveMemberEmail, revokeAgentConnection } from "../../../db/store";
import { privateJsonResponse } from "../../../lib/archive-cache";

async function memberIdentity(): Promise<string | null> {
  const user = await getAppleUser();
  if (!user || !(await getViewerRole(user))) return null;
  return (await resolveMemberEmail(user.email)) ?? user.email.toLowerCase();
}

export async function GET() {
  const email = await memberIdentity();
  if (!email) return Response.json({ error: "unauthorized" }, { status: 401 });
  return privateJsonResponse({ connections: await listAgentConnections(email) });
}

export async function POST(request: Request) {
  const email = await memberIdentity();
  if (!email) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { tokenId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body.tokenId !== "string" || !body.tokenId) return Response.json({ error: "invalid_request" }, { status: 400 });
  const revoked = await revokeAgentConnection(body.tokenId, email);
  return revoked ? Response.json({ ok: true }) : Response.json({ error: "connection_not_found" }, { status: 404 });
}
