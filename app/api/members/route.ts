import { getAppleUser } from "../../apple-auth";
import { getViewerRole, requireAdmin } from "../../authz";
import { linkIdentity, listMembers, removeMember, resolveMemberEmail, unlinkIdentity, upsertMember } from "../../../db/store";
import { preventSharedCaching, privateJsonResponse } from "../../../lib/archive-cache";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return preventSharedCaching(auth.response);
  return privateJsonResponse({ members: await listMembers() });
}

export async function POST(request: Request) {
  const user = await getAppleUser();
  if (!user) return Response.json({ error: "sign_in_required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: string; email?: string; role?: string; memberEmail?: string } | null;
  const email = (body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "invalid_email" }, { status: 400 });
  const isAdmin = (await getViewerRole(user)) === "admin";

  if (body?.action === "unlink") {
    // Anyone may disconnect a sign-in from their OWN account; unlinking
    // someone else's needs an admin.
    const own = (await resolveMemberEmail(user.email)) === (await resolveMemberEmail(email));
    if (!isAdmin && !own) return Response.json({ error: "admin_access_required" }, { status: 403 });
    await unlinkIdentity(email, user.email);
    return Response.json(isAdmin ? { members: await listMembers() } : { ok: true });
  }
  if (!isAdmin) return Response.json({ error: "admin_access_required" }, { status: 403 });
  if (body?.action === "link") {
    const memberEmail = (body.memberEmail || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail)) return Response.json({ error: "invalid_email" }, { status: 400 });
    try {
      await linkIdentity(email, memberEmail, null, user.email);
    } catch {
      return Response.json({ error: "identity_linked_elsewhere" }, { status: 409 });
    }
    return Response.json({ members: await listMembers() });
  }

  // Role and removal actions accept any of an account's identities and act
  // on the canonical member row.
  const canonical = await resolveMemberEmail(email);
  const members = await listMembers();
  const target = members.find((member) => member.email === canonical);
  const lastAdmin = target?.role === "admin" && members.filter((member) => member.role === "admin").length === 1;

  if (body?.action === "remove") {
    if (!target) return Response.json({ error: "not_a_member" }, { status: 404 });
    if (lastAdmin) return Response.json({ error: "last_admin" }, { status: 400 });
    await removeMember(canonical, user.email);
  } else if (body?.action === "set") {
    const role = body.role === "admin" ? "admin" as const : body.role === "canEdit" ? "canEdit" as const : body.role === "canView" ? "canView" as const : null;
    if (!role) return Response.json({ error: "invalid_role" }, { status: 400 });
    if (lastAdmin && role !== "admin") return Response.json({ error: "last_admin" }, { status: 400 });
    await upsertMember(canonical, role, user.email);
  } else {
    return Response.json({ error: "unknown_action" }, { status: 400 });
  }
  return Response.json({ members: await listMembers() });
}
