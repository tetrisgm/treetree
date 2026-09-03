import { getAppleUser, signToken } from "../../../apple-auth";
import { resolveMemberEmail } from "../../../../db/store";
import { preventSharedCaching, privateJsonResponse } from "../../../../lib/archive-cache";

function requiredConfig() {
  const clientId = process.env.APPLE_CLIENT_ID;
  const origin = process.env.PUBLIC_ORIGIN;
  if (!clientId || !origin || !process.env.AUTH_SESSION_SECRET) return null;
  return { clientId, redirectUri: `${origin.replace(/\/$/, "")}/api/auth/apple/callback` };
}

export async function GET(request: Request) {
  const config = requiredConfig();
  if (!config) return privateJsonResponse({ error: "apple_sign_in_not_configured" }, { status: 503 });
  const url = new URL(request.url);
  const requestedReturn = url.searchParams.get("return_to") || "/";
  const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/";
  // Linking: Apple's form_post callback arrives without our SameSite=Lax
  // session cookie, so the signed state carries the initiating account.
  const linker = url.searchParams.get("link") === "1" ? await getAppleUser() : null;
  const linkTo = linker ? await resolveMemberEmail(linker.email) : undefined;
  const nonce = crypto.randomUUID();
  const state = await signToken(
    { nonce, returnTo, ...(linkTo ? { linkTo } : {}), exp: Math.floor(Date.now() / 1000) + 10 * 60 },
    "oauth-state",
  );
  const authorize = new URL("https://appleid.apple.com/auth/authorize");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("response_mode", "form_post");
  authorize.searchParams.set("scope", "name email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  return preventSharedCaching(Response.redirect(authorize, 302));
}
