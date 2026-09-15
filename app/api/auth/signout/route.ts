import { clearSessionCookie } from "../../../apple-auth";
import { preventSharedCaching } from "../../../../lib/archive-cache";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("return_to") || "/";
  const returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  /* Built by hand, not with Response.redirect: that one's headers are
     immutable, so appending the cookie threw and signing out answered 500 -
     a browser error page, and the session still in place. Sign-in has always
     built its redirect this way; this was the one door that did not. */
  const response = new Response(null, { status: 303, headers: { Location: new URL(returnTo, url.origin).toString() } });
  response.headers.append("set-cookie", clearSessionCookie());
  return preventSharedCaching(response);
}
