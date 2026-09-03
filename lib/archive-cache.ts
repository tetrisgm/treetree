import type { SiteVisibility } from "../db/store";

/**
 * Only the genuinely public archive may enter shared caches. Password and
 * member access are both cookie-bound and must stop at the visitor's browser.
 */
export function archiveCacheHeaders(
  visibility: SiteVisibility,
  publicCacheControl: string,
): Record<string, string> {
  if (visibility === "public") return { "cache-control": publicCacheControl };
  return privateArchiveCacheHeaders();
}

export function privateArchiveCacheHeaders(): Record<string, string> {
  return {
    "cache-control": "private, no-store, max-age=0",
    vary: "Cookie",
  };
}

/** Preserve an authorization response while ensuring intermediaries cannot
 * reuse it for a different visitor. */
export function preventSharedCaching(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  const vary = (headers.get("vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!vary.some((value) => value.toLowerCase() === "cookie")) vary.push("Cookie");
  headers.set("vary", vary.join(", "));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** JSON whose contents or authorization decision depends on the visitor's
 * cookie. Keeping this construction in one place makes it harder for a new
 * account endpoint to accidentally inherit framework or CDN caching. */
export function privateJsonResponse(data: unknown, init?: ResponseInit): Response {
  return preventSharedCaching(Response.json(data, init));
}
