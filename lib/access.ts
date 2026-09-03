/** The shared password a family member types to get in, and the link that
 * skips it.
 *
 * Only a keyed digest of the password is ever stored, and nothing in this
 * file returns or logs the password itself.
 *
 * The digest is HMAC-SHA256 over a per-password salt, keyed with
 * AUTH_SESSION_SECRET, rather than a slow KDF. That is a deliberate trade
 * made for one reason: this Worker runs against a CPU limit that behaves
 * like 10ms (see the handoff), and a PBKDF2 with a work factor worth having
 * would not fit inside it. The strength therefore rests on the secret, which
 * is a Worker secret and is not in the database - so the archive's own data,
 * on its own, cannot be attacked offline. Anyone raising the CPU ceiling
 * should replace this with a real KDF and re-prompt for the password once.
 */

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

function secret() {
  const value = process.env.AUTH_SESSION_SECRET || "";
  if (!value) throw new Error("AUTH_SESSION_SECRET is not configured.");
  return value;
}

async function digest(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${salt}:${password}`))));
}

/** Compares without leaking where two digests first differ. */
function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/** `hmac$<salt>$<digest>` - the only form the password is ever kept in. */
export async function hashAccessPassword(password: string): Promise<string> {
  const salt = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  return `hmac$${salt}$${await digest(password, salt)}`;
}

export async function verifyAccessPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "hmac" || !salt || !expected) return false;
  return safeEqual(await digest(password, salt), expected);
}

/** The token in a private link. 32 random bytes: long enough that guessing
 * it is not a strategy, short enough to paste into a message. */
export function newShareToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export const ACCESS_COOKIE = "archive_access";
export const ACCESS_TTL_SECONDS = 90 * 24 * 60 * 60;
