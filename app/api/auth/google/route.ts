import { getAppleUser, signToken } from "../../../apple-auth";
import { resolveMemberEmail } from "../../../../db/store";
import { preventSharedCaching, privateJsonResponse } from "../../../../lib/archive-cache";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const origin = (process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  if (!clientId || !origin || !process.env.AUTH_SESSION_SECRET) {
    return privateJsonResponse({ error: "google_sign_in_not_configured" }, { status: 503 });
  }
  const url = new URL(request.url);
  const requestedReturn = url.searchParams.get("return_to") || "/";
  const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/";
  // Linking: when a signed-in user asks to link this provider, the signed
  // state carries their canonical account so the callback can attach the
  // proven identity to it (the session cookie does not survive every
  // provider's cross-site callback, the state token does).
  const linker = url.searchParams.get("link") === "1" ? await getAppleUser() : null;
  const linkTo = linker ? await resolveMemberEmail(linker.email) : undefined;
  const nonce = crypto.randomUUID();
  const state = await signToken(
    { nonce, returnTo, ...(linkTo ? { linkTo } : {}), exp: Math.floor(Date.now() / 1000) + 10 * 60 },
    "oauth-state",
  );
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", `${origin}/api/auth/google/callback`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("prompt", "select_account");
  return preventSharedCaching(Response.redirect(authorize, 302));
}
