/** The first-run sign-in token: an HMAC over the owner's email keyed with
 * AUTH_SESSION_SECRET. Only the deployer holds the secret, so presenting the
 * digest proves they ran the setup. scripts/setup.mjs computes the same
 * value in Node to print the link. */

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

export async function bootstrapToken(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`bootstrap-signin:${email.toLowerCase()}`))));
}

/** Compares two equal-length digests without leaking where they differ. */
export function digestsEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
