import { getAppleUser } from "../../../apple-auth";
import { getViewerRole } from "../../../authz";
import { publicOrigin } from "../../../../lib/archive-config";
import { mintAuthorizationCode, validateAuthorizeRequest } from "../../../../lib/mcp-oauth";

export const runtime = "edge";

// Response.redirect() headers are immutable and adding Cache-Control to one
// throws - the mcp-kit shipped that 500 to production once. Build it by hand.
const redirect = (location: string) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

export async function POST(request: Request) {
  // the consent form must come from this origin, not a cross-site POST
  const origin = request.headers.get("origin");
  const selfOrigins = new Set([publicOrigin(), new URL(request.url).origin]);
  if (origin && !selfOrigins.has(origin)) return new Response("Cross-origin approval rejected.", { status: 403 });

  const form = await request.formData();
  const params = new URLSearchParams();
  for (const key of ["client_id", "redirect_uri", "code_challenge", "scope", "state"]) {
    const value = form.get(key);
    if (typeof value === "string") params.set(key, value);
  }
  params.set("code_challenge_method", "S256");
  const validated = await validateAuthorizeRequest(params);
  if (!validated.ok) return new Response(validated.problem, { status: 400 });

  const user = await getAppleUser();
  const role = await getViewerRole(user);
  if (!user || !role) return new Response("Sign in as a member before approving.", { status: 401 });

  const destination = new URL(validated.request.redirectUri);
  if (validated.request.state != null) destination.searchParams.set("state", validated.request.state);
  if (form.get("decision") !== "approve") {
    destination.searchParams.set("error", "access_denied");
    return redirect(destination.toString());
  }
  destination.searchParams.set("code", await mintAuthorizationCode(validated.request, user.email.toLowerCase()));
  return redirect(destination.toString());
}
