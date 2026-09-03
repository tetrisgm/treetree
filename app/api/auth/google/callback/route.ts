import { createRemoteJWKSet, jwtVerify } from "jose";
import { createSession, sessionCookie, verifyToken } from "../../../../apple-auth";
import { linkIdentity, recordSignInProvider, registerViewer } from "../../../../../db/store";
import { preventSharedCaching, privateJsonResponse } from "../../../../../lib/archive-cache";

type State = { nonce: string; returnTo: string; linkTo?: string; exp: number };
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const origin = (process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  if (!clientId || !clientSecret || !origin) {
    return privateJsonResponse({ error: "google_sign_in_not_configured" }, { status: 503 });
  }
  const url = new URL(request.url);
  const state = await verifyToken<State>(url.searchParams.get("state") || "", "oauth-state");
  const code = url.searchParams.get("code") || "";
  if (!state || !code) return preventSharedCaching(Response.redirect(`${origin}/settings?auth_error=invalid_response`, 303));

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${origin}/api/auth/google/callback`,
      }),
    });
    const tokens = await tokenResponse.json() as { id_token?: string; error?: string };
    if (!tokenResponse.ok || !tokens.id_token) throw new Error(`token_exchange_failed:${tokens.error || tokenResponse.status}`);
    const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    if (payload.nonce !== state.nonce || typeof payload.sub !== "string" || typeof payload.email !== "string") {
      throw new Error("invalid_identity_token");
    }
    const email = payload.email.toLowerCase();
    const displayName = typeof payload.name === "string" && payload.name ? payload.name : email.split("@")[0];
    // A link request attaches this proven identity to the initiating account.
    if (state.linkTo && state.linkTo !== email) await linkIdentity(email, state.linkTo, "google", state.linkTo);
    // Anyone may sign in; a first sign-in registers the account as a viewer
    // and admins assign roles from there.
    await registerViewer(email);
    await recordSignInProvider(email, "google");
    const session = await createSession({ subject: `google:${payload.sub}`, email, displayName });
    const response = new Response(null, { status: 303, headers: { Location: `${origin}${state.returnTo}` } });
    response.headers.append("set-cookie", sessionCookie(session));
    return preventSharedCaching(response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    console.warn("Google sign-in failed", detail);
    const errorCode = detail.startsWith("token_exchange_failed") ? "google_token_exchange_failed" : detail === "invalid_identity_token" || detail === "identity_linked_elsewhere" ? detail : "sign_in_failed";
    return preventSharedCaching(Response.redirect(`${origin}/settings?auth_error=${errorCode}`, 303));
  }
}
