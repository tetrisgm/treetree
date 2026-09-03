import { cookies } from "next/headers";

export type AppleUser = {
  subject: string;
  email: string;
  displayName: string;
};

export type SignedTokenPurpose = "session" | "archive-access" | "oauth-state";

const SESSION_COOKIE = "archive_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
let cachedHmacKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function secret() {
  return process.env.AUTH_SESSION_SECRET || "";
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(value: string) {
  const currentSecret = secret();
  if (!cachedHmacKey || cachedHmacKey.secret !== currentSecret) {
    cachedHmacKey = {
      secret: currentSecret,
      key: crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(currentSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    };
  }
  const key = await cachedHmacKey.key;
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function signToken(
  payload: Record<string, unknown> & { exp: number },
  purpose: SignedTokenPurpose,
) {
  if (!secret()) throw new Error("AUTH_SESSION_SECRET is not configured.");
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...payload, purpose })));
  return `${encoded}.${await hmac(encoded)}`;
}

async function verifiedClaims(token: string | undefined): Promise<Record<string, unknown> | null> {
  if (!secret() || !token) return null;
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const encoded = token.slice(0, separator);
  if (!safeEqual(token.slice(separator + 1), await hmac(encoded))) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as unknown;
    if (!value || typeof value !== "object") return null;
    const claims = value as Record<string, unknown>;
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || Date.now() / 1000 > claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function verifyToken<T>(
  token: string | undefined,
  expectedPurpose: SignedTokenPurpose,
): Promise<T | null> {
  const claims = await verifiedClaims(token);
  return claims?.purpose === expectedPurpose ? claims as T : null;
}

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

const isUserClaims = (value: Record<string, unknown>) =>
  typeof value.subject === "string"
  && typeof value.email === "string"
  && typeof value.displayName === "string";

/** Old access cookies did not carry a purpose. Their exact two-field shape is
 * still safe to honor: session and OAuth-state tokens cannot satisfy it. */
export async function verifyArchiveAccessToken(token: string | undefined): Promise<boolean> {
  const claims = await verifiedClaims(token);
  if (!claims || claims.access !== true) return false;
  if (claims.purpose === "archive-access") {
    return hasOnlyKeys(claims, ["access", "exp", "purpose"]);
  }
  return claims.purpose === undefined && hasOnlyKeys(claims, ["access", "exp"]);
}

export async function createSession(user: AppleUser) {
  return signToken({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }, "session");
}

export function sessionCookie(value: string) {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function getAppleUser(): Promise<AppleUser | null> {
  const store = await cookies();
  const claims = await verifiedClaims(store.get(SESSION_COOKIE)?.value);
  if (!claims || !isUserClaims(claims)) return null;
  const current = claims.purpose === "session"
    && hasOnlyKeys(claims, ["subject", "email", "displayName", "exp", "purpose"]);
  const legacy = claims.purpose === undefined
    && hasOnlyKeys(claims, ["subject", "email", "displayName", "exp"]);
  if (!current && !legacy) return null;
  return { subject: claims.subject as string, email: claims.email as string, displayName: claims.displayName as string };
}

export function appleSignInPath(returnTo = "/") {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/api/auth/apple?return_to=${encodeURIComponent(safe)}`;
}

export function appleSignOutPath(returnTo = "/") {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/api/auth/signout?return_to=${encodeURIComponent(safe)}`;
}
