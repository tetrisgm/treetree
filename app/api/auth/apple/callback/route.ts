import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { createSession, sessionCookie, verifyToken } from "../../../../apple-auth";
import { linkIdentity, recordSignInProvider, registerViewer } from "../../../../../db/store";
import { preventSharedCaching, privateJsonResponse } from "../../../../../lib/archive-cache";

type State = { nonce: string; returnTo: string; linkTo?: string; exp: number };
const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

function normalizedPrivateKey() {
  return (process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

async function clientSecret(clientId: string, teamId: string, keyId: string) {
  const key = await importPKCS8(normalizedPrivateKey(), "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

async function nonceMatches(tokenNonce: unknown, expected: string) {
  if (tokenNonce === expected) return true;
  if (typeof tokenNonce !== "string") return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected));
  const hashed = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return tokenNonce === hashed;
}

export async function POST(request: Request) {
  const clientId = process.env.APPLE_CLIENT_ID || "";
  const teamId = process.env.APPLE_TEAM_ID || "";
  const keyId = process.env.APPLE_KEY_ID || "";
  const origin = (process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  if (!clientId || !teamId || !keyId || !origin || !normalizedPrivateKey()) {
    return privateJsonResponse({ error: "apple_sign_in_not_configured" }, { status: 503 });
  }
  const form = await request.formData();
  const state = await verifyToken<State>(String(form.get("state") || ""), "oauth-state");
  const code = String(form.get("code") || "");
  if (!state || !code) return preventSharedCaching(Response.redirect(`${origin}/settings?auth_error=invalid_response`, 303));

  try {
    const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: await clientSecret(clientId, teamId, keyId),
        code,
        grant_type: "authorization_code",
        redirect_uri: `${origin}/api/auth/apple/callback`,
      }),
    });
    const tokens = await tokenResponse.json() as { id_token?: string; error?: string };
    if (!tokenResponse.ok || !tokens.id_token) throw new Error(`token_exchange_failed:${tokens.error || tokenResponse.status}`);
    const { payload } = await jwtVerify(tokens.id_token, appleKeys, {
      issuer: "https://appleid.apple.com",
      audience: clientId,
    });
    if (!(await nonceMatches(payload.nonce, state.nonce)) || typeof payload.sub !== "string" || typeof payload.email !== "string") {
      throw new Error("invalid_identity_token");
    }
    const email = payload.email.toLowerCase();
    // A link request attaches this proven identity to the initiating account.
    if (state.linkTo && state.linkTo !== email) await linkIdentity(email, state.linkTo, "apple", state.linkTo);
    // Anyone may sign in; a first sign-in registers the account as a viewer
    // and admins assign roles from there.
    await registerViewer(email);
    await recordSignInProvider(email, "apple");
    const session = await createSession({ subject: payload.sub, email, displayName: email.split("@")[0] });
    const response = new Response(null, { status: 303, headers: { Location: `${origin}${state.returnTo}` } });
    response.headers.append("set-cookie", sessionCookie(session));
    return preventSharedCaching(response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown_error";
    console.warn("Apple sign-in failed", detail);
    const code = detail.startsWith("token_exchange_failed") ? "apple_token_exchange_failed" : detail === "invalid_identity_token" || detail === "identity_linked_elsewhere" ? detail : "sign_in_failed";
    return preventSharedCaching(Response.redirect(`${origin}/settings?auth_error=${code}`, 303));
  }
}
