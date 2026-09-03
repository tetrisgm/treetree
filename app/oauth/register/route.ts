// RFC 7591 dynamic client registration: MCP clients call this themselves
// during discovery, before any human is involved.
import { registerClient } from "../../../lib/mcp-oauth";

export const runtime = "edge";

export async function POST(request: Request) {
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "The registration body must be JSON." }, { status: 400 });
  }
  const name = typeof body.client_name === "string" ? body.client_name : "MCP client";
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
  try {
    const client = await registerClient(name, uris);
    return Response.json({
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }, { status: 201, headers: { "access-control-allow-origin": "*" } });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_redirect_uri") {
      return Response.json({ error: "invalid_redirect_uri", error_description: "Redirect URIs must be https (or localhost for CLI clients)." }, { status: 400 });
    }
    // infrastructure failure (for example an exhausted D1 quota), not the client's fault
    console.error("oauth_registration_failed", error instanceof Error ? error.message : String(error));
    return Response.json({ error: "temporarily_unavailable", error_description: "Registration is temporarily unavailable; try again later." }, { status: 503 });
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" } });
