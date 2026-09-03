// First-run sign-in with no OAuth provider configured.
//
// scripts/setup.mjs prints a link carrying an HMAC over the owner's email,
// keyed with AUTH_SESSION_SECRET - proof the visitor ran the setup, since
// only the deployer holds that secret. It signs the owner in directly so a
// fresh archive works the moment it deploys; registering Apple/Google
// sign-in becomes a later, optional step (needed to invite the family).
// The link dies the moment the owner links a real provider, so it cannot
// remain a skeleton key on an archive that has graduated to real sign-in.
import { createSession, sessionCookie } from "../../../apple-auth";
import { listConnectedProviders } from "../../../../db/store";
import { ownerEmail } from "../../../../lib/archive-config";
import { bootstrapToken, digestsEqual } from "../../../../lib/bootstrap-signin";

export const runtime = "edge";

export async function GET(request: Request) {
  const owner = ownerEmail();
  const secret = process.env.AUTH_SESSION_SECRET || "";
  const presented = new URL(request.url).searchParams.get("token") ?? "";
  if (!owner || !secret || !presented) return new Response("This archive has no bootstrap sign-in.", { status: 404 });
  if (!digestsEqual(presented, await bootstrapToken(owner, secret))) {
    return new Response("That bootstrap link is not valid.", { status: 403 });
  }
  if ((await listConnectedProviders(owner)).length > 0) {
    return new Response("The owner already signs in with a real provider, so the bootstrap link has retired. Sign in from the settings page.", { status: 403 });
  }
  const session = await createSession({ subject: "bootstrap-owner", email: owner, displayName: owner.split("@")[0] });
  return new Response(null, { status: 302, headers: { location: "/", "set-cookie": sessionCookie(session), "cache-control": "no-store" } });
}
