import { signToken } from "../../apple-auth";
import { getSiteVisibility, accessPasswordDigest, shareToken } from "../../../db/store";
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, verifyAccessPassword } from "../../../lib/access";
import { preventSharedCaching, privateJsonResponse } from "../../../lib/archive-cache";
import { limitRequest } from "../../../lib/rate-limit";

export const runtime = "edge";

/** Answering the family password, or arriving by the private link.
 *
 * Both end in the same place: a signed cookie that says this browser has been
 * let in, good for ninety days. Neither the password nor the link token is
 * ever echoed back, and a wrong answer says only that it was wrong. */

function grantCookie(token: string) {
  return `${ACCESS_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ACCESS_TTL_SECONDS}`;
}

async function grant(): Promise<string> {
  return grantCookie(await signToken(
    { access: true, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS },
    "archive-access",
  ));
}

export async function POST(request: Request) {
  if ((await getSiteVisibility(true)) !== "password") {
    return privateJsonResponse({ error: "not_password_protected" }, { status: 400 });
  }
  const limited = await limitRequest(request, "archive-password", 10, 15 * 60);
  if (limited) return limited;
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) return privateJsonResponse({ error: "password_required" }, { status: 400 });
  if (!(await verifyAccessPassword(password, await accessPasswordDigest()))) {
    return privateJsonResponse({ error: "wrong_password" }, { status: 401 });
  }
  return privateJsonResponse({ ok: true }, { headers: { "set-cookie": await grant() } });
}

/** The private link: /api/access?key=… lets the holder in and sends them to
 * the archive with the token out of the address bar, so it is not left in
 * history or handed on in a screenshot of the page. */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const expected = await shareToken();
  if (!key || !expected || key !== expected) {
    return preventSharedCaching(new Response(null, { status: 302, headers: { location: "/" } }));
  }
  return preventSharedCaching(new Response(null, { status: 302, headers: { location: "/", "set-cookie": await grant() } }));
}
