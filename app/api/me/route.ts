import { getAppleUser } from "../../apple-auth";
import { getViewerRole } from "../../authz";
import { claimMemberPerson, getMemberPerson } from "../../../db/store";
import { privateJsonResponse } from "../../../lib/archive-cache";

export const runtime = "edge";

/** Which person in the tree the signed-in account belongs to.
 *
 * Only the account itself can say - this is not an admin setting someone
 * else's identity - and only for an account that is on the member list. A
 * person already claimed by another account is refused, because two accounts
 * standing in the same place makes "where I am in the tree" meaningless for
 * both of them. */

export async function GET() {
  const user = await getAppleUser();
  if (!user) return privateJsonResponse({ signedIn: false, personId: null });
  return privateJsonResponse({ signedIn: true, personId: await getMemberPerson(user.email) });
}

export async function POST(request: Request) {
  const user = await getAppleUser();
  if (!user) return Response.json({ error: "sign_in_required" }, { status: 401 });
  if (!(await getViewerRole(user))) return Response.json({ error: "not_a_member" }, { status: 403 });
  const body = await request.json().catch(() => null) as { personId?: unknown } | null;
  const personId = typeof body?.personId === "string" && body.personId ? body.personId : null;
  const result = await claimMemberPerson(user.email, personId);
  if (result === "taken") return Response.json({ error: "already_claimed" }, { status: 409 });
  if (result === "unknown_person") return Response.json({ error: "unknown_person" }, { status: 400 });
  return Response.json({ personId });
}
