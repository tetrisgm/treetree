import { cookies } from "next/headers";
import { getAppleUser, verifyArchiveAccessToken, type AppleUser } from "./apple-auth";
import { getMemberRole, getSiteVisibility, type MemberRole, type SiteVisibility } from "../db/store";
import { ACCESS_COOKIE } from "../lib/access";

// Editing is enforced: only members with the editor or admin role can
// mutate the archive. Flipping this to true reopens the old test mode where
// every visitor could edit.
export const TEMPORARY_OPEN_EDITOR = false;
const temporaryEditor: AppleUser = { subject: "temporary-open-editor", email: "temporary-open-editor@example.com", displayName: "Temporary editor" };

export type ViewerRole = MemberRole | null;

/** The signed-in user's role from the members table; null when signed out
 * or not on the list. */
export async function getViewerRole(user: AppleUser | null): Promise<ViewerRole> {
  if (!user) return null;
  return getMemberRole(user.email);
}

export async function isArchiveMember(): Promise<boolean> {
  return Boolean(await getViewerRole(await getAppleUser()));
}

export async function requireEditor(): Promise<
  { ok: true; user: AppleUser } | { ok: false; response: Response }
> {
  const user = await getAppleUser();
  if (TEMPORARY_OPEN_EDITOR) return { ok: true, user: user ?? temporaryEditor };
  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "sign_in_required" }, { status: 401 }),
    };
  }
  const role = await getViewerRole(user);
  if (role !== "admin" && role !== "canEdit") {
    return {
      ok: false,
      response: Response.json({ error: "editor_access_required" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}

/** Whether this visitor has already answered the family password, or arrived
 * by the private link. Signed with the same secret as a member session and
 * carries its own expiry. */
export async function hasAccessPass(): Promise<boolean> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  return verifyArchiveAccessToken(token);
}

export type VisitorGate = "ok" | "sign-in" | "not-a-member" | "password";

/** Who may read the archive.
 *
 * "public": everyone. "members": a signed-in person on the member list.
 * "password": the same member list, or anyone who knows the family password
 * or has followed the private link. Being on the member list always passes,
 * in every mode - the owner asked that people they have added are never
 * asked for the password. */
export async function visitorGate(
  knownVisibility?: SiteVisibility,
): Promise<VisitorGate> {
  const visibility = knownVisibility ?? await getSiteVisibility(true);
  if (visibility === "public") return "ok";
  const user = await getAppleUser();
  if (user && (await getViewerRole(user))) return "ok";
  if (visibility === "password") return (await hasAccessPass()) ? "ok" : "password";
  return user ? "not-a-member" : "sign-in";
}

export async function requireVisitor(): Promise<
  { ok: true; visibility: SiteVisibility } | { ok: false; response: Response }
> {
  // Access and cache classification must use the same fresh value. The
  // per-isolate visibility cache is useful for display-only reads, but an
  // isolate can otherwise keep treating a newly-private archive as public for
  // ten seconds after another isolate changes the setting.
  const visibility = await getSiteVisibility(true);
  const gate = await visitorGate(visibility);
  if (gate === "ok") return { ok: true, visibility };
  if (gate === "password") return { ok: false, response: Response.json({ error: "password_required" }, { status: 401 }) };
  if (gate === "sign-in") return { ok: false, response: Response.json({ error: "sign_in_required" }, { status: 401 }) };
  return { ok: false, response: Response.json({ error: "viewer_access_required" }, { status: 403 }) };
}

/** Member management is admin-only and is never opened by the temporary
 * open-editor test mode. */
export async function requireAdmin(): Promise<
  { ok: true; user: AppleUser } | { ok: false; response: Response }
> {
  const user = await getAppleUser();
  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "sign_in_required" }, { status: 401 }),
    };
  }
  if ((await getViewerRole(user)) !== "admin") {
    return {
      ok: false,
      response: Response.json({ error: "admin_access_required" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}
