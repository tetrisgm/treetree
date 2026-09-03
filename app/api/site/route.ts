import { requireAdmin } from "../../authz";
import {
  clearAccessPassword, getSiteVisibility, hasAccessPassword, setAccessPasswordDigest,
  setShareToken, setSiteVisibility, shareToken, type SiteVisibility,
} from "../../../db/store";
import { hashAccessPassword, newShareToken } from "../../../lib/access";
import { preventSharedCaching, privateJsonResponse } from "../../../lib/archive-cache";

/** Who can see the archive, the family password, and the private link.
 *
 * Admin only, and the password is write-only: this route can be told a new
 * one, and can say whether one exists, but there is no request that returns
 * it - the stored form is a keyed digest and the plaintext is never kept. */

const VISIBILITIES: SiteVisibility[] = ["public", "members", "password"];

async function state() {
  const [visibility, hasPassword, token] = await Promise.all([
    getSiteVisibility(true),
    hasAccessPassword(),
    shareToken(),
  ]);
  return {
    visibility,
    hasPassword,
    shareUrl: token ? `/api/access?key=${token}` : null,
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return preventSharedCaching(auth.response);
  return privateJsonResponse(await state());
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return preventSharedCaching(auth.response);
  const body = await request.json().catch(() => null) as { visibility?: string; password?: unknown; action?: string } | null;

  if (body?.action === "set_password") {
    const password = typeof body.password === "string" ? body.password.trim() : "";
    if (password.length < 6) return privateJsonResponse({ error: "password_too_short" }, { status: 400 });
    await setAccessPasswordDigest(await hashAccessPassword(password), auth.user.email);
    // a password is no use without a link to go with it
    if (!(await shareToken())) await setShareToken(newShareToken(), auth.user.email);
    return privateJsonResponse(await state());
  }
  if (body?.action === "clear_password") {
    // Removing the password while the archive is behind it would change who
    // can see the archive as a side effect of a different request. Say no and
    // let the admin choose.
    if ((await getSiteVisibility(true)) === "password") {
      return privateJsonResponse({ error: "password_in_use" }, { status: 400 });
    }
    await clearAccessPassword(auth.user.email);
    return privateJsonResponse(await state());
  }
  if (body?.action === "new_link") {
    await setShareToken(newShareToken(), auth.user.email);
    return privateJsonResponse(await state());
  }

  const visibility = VISIBILITIES.find((candidate) => candidate === body?.visibility);
  if (!visibility) return privateJsonResponse({ error: "invalid_visibility" }, { status: 400 });
  // locking the door needs a key to have been cut first
  if (visibility === "password" && !(await hasAccessPassword())) {
    return privateJsonResponse({ error: "set_a_password_first" }, { status: 400 });
  }
  await setSiteVisibility(visibility, auth.user.email);
  return privateJsonResponse(await state());
}
