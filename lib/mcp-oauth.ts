/** Click-to-approve OAuth for the hosted MCP server.
 *
 * The discovery chain (RFC 9728 + 8414 + dynamic registration + PKCE) is the
 * mcp-kit pattern: an MCP client pastes the /api/mcp URL, self-registers,
 * sends the member to /oauth/authorize, and the Approve click mints a bearer
 * token. The token is a normal archive credential: hashed at rest, bound to
 * the member's email, and useless the moment that member leaves the list,
 * because every call re-resolves the member's current role.
 *
 * Token lifecycle follows the kit: one-hour access tokens plus hashed
 * rotating refresh tokens. A connection is a token family with a 180-day
 * absolute and 30-day inactivity lifetime; presenting an already-consumed
 * refresh token is treated as a replay and revokes the entire family and
 * every access token it issued.
 */

import { env } from "cloudflare:workers";
import { ensureSchema } from "../db/store";
import { publicOrigin } from "./archive-config";

/** "read" queries the archive; "propose" additionally files additive change
 * proposals for editor review (and includes read). */
export const MCP_SCOPES = ["read", "propose"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const CODE_TTL_SECONDS = 60 * 10;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_ABSOLUTE_TTL_SECONDS = 180 * 24 * 60 * 60;
export const REFRESH_INACTIVITY_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();
const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

export async function sha256Base64Url(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export type OAuthClient = { clientId: string; name: string; redirectUris: string[] };

const httpsRedirect = (uri: string) => {
  try {
    const url = new URL(uri);
    if (url.protocol === "https:") return true;
    // loopback redirects are how CLI clients (Claude Code, Cursor) receive
    // the code; the MCP ecosystem depends on them, so they stay allowed
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
};

export async function registerClient(name: string, redirectUris: string[]): Promise<OAuthClient> {
  await ensureSchema();
  const cleanName = name.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 120).trim() || "MCP client";
  const uris = redirectUris.filter((uri) => typeof uri === "string" && uri.length <= 2048 && httpsRedirect(uri));
  if (!uris.length) throw new Error("invalid_redirect_uri");
  const clientId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, name, redirect_uris_json, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, cleanName, JSON.stringify(uris), new Date().toISOString()).run();
  return { clientId, name: cleanName, redirectUris: uris };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  await ensureSchema();
  const row = await env.DB.prepare("SELECT client_id AS clientId, name, redirect_uris_json AS redirectUrisJson FROM oauth_clients WHERE client_id = ?")
    .bind(clientId).first<{ clientId: string; name: string; redirectUrisJson: string }>();
  if (!row) return null;
  return { clientId: row.clientId, name: row.name, redirectUris: JSON.parse(row.redirectUrisJson) as string[] };
}

export type AuthorizeRequest = {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  scope: McpScope;
  state: string | null;
};

/** Validates the /oauth/authorize query. Errors that predate a trusted
 * redirect URI must render, never redirect. */
export async function validateAuthorizeRequest(params: URLSearchParams): Promise<{ ok: true; request: AuthorizeRequest } | { ok: false; problem: string }> {
  const clientId = params.get("client_id") ?? "";
  const client = clientId ? await getClient(clientId) : null;
  if (!client) return { ok: false, problem: "Unknown client. The connecting app must register first." };
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, problem: "The redirect address does not match the one this client registered." };
  if ((params.get("response_type") ?? "code") !== "code") return { ok: false, problem: "Only the authorization-code flow is supported." };
  if ((params.get("code_challenge_method") ?? "") !== "S256") return { ok: false, problem: "PKCE with S256 is required." };
  const codeChallenge = params.get("code_challenge") ?? "";
  if (!CODE_CHALLENGE_RE.test(codeChallenge)) return { ok: false, problem: "The PKCE challenge is malformed." };
  const requested = (params.get("scope") ?? "read").split(/\s+/).filter(Boolean);
  if (requested.some((scope) => !MCP_SCOPES.some((known) => known === scope))) return { ok: false, problem: "Unknown scope requested." };
  // propose includes read; a standards-compliant request naming both scopes
  // normalizes to the effective one
  const scope: McpScope = requested.includes("propose") ? "propose" : "read";
  return { ok: true, request: { client, redirectUri, codeChallenge, scope, state: params.get("state") } };
}

export async function mintAuthorizationCode(request: AuthorizeRequest, memberEmail: string): Promise<string> {
  const code = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(new Date(now).toISOString()),
    env.DB.prepare("INSERT INTO oauth_codes (code_hash, member_email, client_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(await sha256Base64Url(code), memberEmail, request.client.clientId, request.redirectUri, request.codeChallenge, request.scope, new Date(now + CODE_TTL_SECONDS * 1000).toISOString()),
  ]);
  return code;
}

export type TokenExchange =
  | { ok: true; body: { access_token: string; refresh_token: string; token_type: "Bearer"; expires_in: number; scope: McpScope } }
  | { ok: false; error: string; description: string };

/** One access token + one refresh token inside a family, atomically. */
async function issueTokens(family: { id: string; memberEmail: string; clientId: string; clientName: string; scope: string }, extraStatements: D1PreparedStatement[] = []): Promise<{ accessToken: string; refreshToken: string }> {
  const now = new Date().toISOString();
  const accessToken = `dat_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const refreshToken = `drt_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const accessTokenId = crypto.randomUUID();
  await env.DB.batch([
    ...extraStatements,
    env.DB.prepare("INSERT INTO agent_tokens (id, token_hash, member_email, client_id, client_name, scope, created_at, expires_at, family_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(accessTokenId, await sha256Base64Url(accessToken), family.memberEmail, family.clientId, family.clientName, family.scope, now, new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(), family.id),
    env.DB.prepare("INSERT INTO agent_refresh_tokens (id, family_id, token_hash, access_token_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), family.id, await sha256Base64Url(refreshToken), accessTokenId, now),
  ]);
  return { accessToken, refreshToken };
}

export async function exchangeCodeForToken(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string }): Promise<TokenExchange> {
  await ensureSchema();
  if (!CODE_VERIFIER_RE.test(input.codeVerifier)) return { ok: false, error: "invalid_grant", description: "Malformed PKCE verifier." };
  const codeHash = await sha256Base64Url(input.code);
  const now = new Date().toISOString();
  // single-statement consume: a replayed or expired code updates zero rows
  const consumed = await env.DB.prepare(`UPDATE oauth_codes SET consumed_at = ?
      WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND consumed_at IS NULL AND expires_at > ?
      RETURNING member_email AS memberEmail, code_challenge AS codeChallenge, scope`)
    .bind(now, codeHash, input.clientId, input.redirectUri, now)
    .first<{ memberEmail: string; codeChallenge: string; scope: string }>();
  if (!consumed) return { ok: false, error: "invalid_grant", description: "The authorization code is invalid, expired, or already used." };
  if (await sha256Base64Url(input.codeVerifier) !== consumed.codeChallenge) return { ok: false, error: "invalid_grant", description: "PKCE verification failed." };
  const client = await getClient(input.clientId);
  const family = { id: crypto.randomUUID(), memberEmail: consumed.memberEmail, clientId: input.clientId, clientName: client?.name ?? "MCP client", scope: consumed.scope };
  const { accessToken, refreshToken } = await issueTokens(family, [
    env.DB.prepare(`INSERT INTO agent_token_families (id, member_email, client_id, client_name, scope, created_at, last_used_at, absolute_expires_at, inactivity_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(family.id, family.memberEmail, family.clientId, family.clientName, family.scope, now, now,
        new Date(Date.now() + REFRESH_ABSOLUTE_TTL_SECONDS * 1000).toISOString(),
        new Date(Date.now() + REFRESH_INACTIVITY_TTL_SECONDS * 1000).toISOString()),
  ]);
  return { ok: true, body: { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, scope: consumed.scope as McpScope } };
}

export async function rotateRefreshToken(input: { refreshToken: string; clientId: string }): Promise<TokenExchange> {
  await ensureSchema();
  if (!input.refreshToken.startsWith("drt_")) return { ok: false, error: "invalid_grant", description: "Unrecognized refresh token." };
  const now = new Date();
  const nowIso = now.toISOString();
  const presented = await env.DB.prepare(`SELECT rt.id, rt.consumed_at AS consumedAt, rt.access_token_id AS accessTokenId,
      f.id AS familyId, f.member_email AS memberEmail, f.client_id AS clientId, f.client_name AS clientName, f.scope,
      f.revoked_at AS revokedAt, f.absolute_expires_at AS absoluteExpiresAt, f.inactivity_expires_at AS inactivityExpiresAt
      FROM agent_refresh_tokens rt JOIN agent_token_families f ON f.id = rt.family_id
      WHERE rt.token_hash = ?`)
    .bind(await sha256Base64Url(input.refreshToken))
    .first<{ id: string; consumedAt: string | null; accessTokenId: string; familyId: string; memberEmail: string; clientId: string; clientName: string; scope: string; revokedAt: string | null; absoluteExpiresAt: string; inactivityExpiresAt: string }>();
  if (!presented || presented.clientId !== input.clientId) return { ok: false, error: "invalid_grant", description: "Unrecognized refresh token." };
  if (presented.consumedAt) {
    // replay: a consumed refresh token came back, so someone else may hold
    // this family's credentials - revoke everything it ever issued
    await env.DB.batch([
      env.DB.prepare("UPDATE agent_token_families SET revoked_at = COALESCE(revoked_at, ?), replay_detected_at = COALESCE(replay_detected_at, ?) WHERE id = ?")
        .bind(nowIso, nowIso, presented.familyId),
      env.DB.prepare("UPDATE agent_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL").bind(nowIso, presented.familyId),
    ]);
    console.warn("agent_refresh_replay_family_revoked");
    return { ok: false, error: "invalid_grant", description: "This refresh token was already used; the connection has been revoked. Reconnect and approve again." };
  }
  if (presented.revokedAt || presented.absoluteExpiresAt <= nowIso || presented.inactivityExpiresAt <= nowIso) {
    return { ok: false, error: "invalid_grant", description: "This connection has ended. Reconnect and approve again." };
  }
  // atomic consume: losing a race to another rotation means zero rows change
  const claimed = await env.DB.prepare("UPDATE agent_refresh_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL RETURNING id")
    .bind(nowIso, presented.id).first<{ id: string }>();
  if (!claimed) return { ok: false, error: "invalid_grant", description: "This refresh token was already used." };
  const { accessToken, refreshToken } = await issueTokens(
    { id: presented.familyId, memberEmail: presented.memberEmail, clientId: presented.clientId, clientName: presented.clientName, scope: presented.scope },
    [
      env.DB.prepare("UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(nowIso, presented.accessTokenId),
      env.DB.prepare("UPDATE agent_token_families SET last_used_at = ?, inactivity_expires_at = MIN(absolute_expires_at, ?) WHERE id = ?")
        .bind(nowIso, new Date(now.getTime() + REFRESH_INACTIVITY_TTL_SECONDS * 1000).toISOString(), presented.familyId),
    ],
  );
  return { ok: true, body: { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, scope: presented.scope as McpScope } };
}

export type AgentIdentity = { memberEmail: string; clientName: string; scope: McpScope; role: "admin" | "canEdit" | "canView"; personId: string | null };

/** Resolves a presented bearer token to a live member. Role is re-read on
 * every call so removing someone from the member list revokes their agents. */
export async function resolveAgentToken(authorization: string | null): Promise<AgentIdentity | null> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token || !token.startsWith("dat_")) return null;
  await ensureSchema();
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`SELECT t.id, t.member_email AS memberEmail, t.client_name AS clientName, t.scope, m.role, m.person_id AS personId
      FROM agent_tokens t JOIN members m ON m.email = t.member_email
      WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ?`)
    .bind(await sha256Base64Url(token), now)
    .first<{ id: string; memberEmail: string; clientName: string; scope: string; role: "admin" | "canEdit" | "canView"; personId: string | null }>();
  if (!row) return null;
  await env.DB.prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?").bind(now, row.id).run();
  return { memberEmail: row.memberEmail, clientName: row.clientName, scope: row.scope as McpScope, role: row.role, personId: row.personId };
}

/** RFC 8414 + 9728 documents; every MCP client discovery starts here. */
export function authorizationServerMetadata() {
  const origin = publicOrigin();
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
  };
}

export function protectedResourceMetadata() {
  const origin = publicOrigin();
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

/** CORS every discovery document, or browser-based clients cannot read them. */
export function discoveryJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type, mcp-protocol-version",
      "cache-control": "public, max-age=300",
    },
  });
}

export const discoveryOptions = () => new Response(null, {
  status: 204,
  headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, mcp-protocol-version",
  },
});
