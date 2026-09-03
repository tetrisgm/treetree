import { addComment, listComments, removeComment } from "../../../db/store";
import { getViewerRole } from "../../authz";
import { getAppleUser } from "../../apple-auth";
import { privateJsonResponse } from "../../../lib/archive-cache";

export const runtime = "edge";

/** Comments are the family talking to each other about a record, so any
 * signed-in member may leave one - not just editors. */
async function member() {
  const user = await getAppleUser();
  if (!user) return null;
  const role = await getViewerRole(user);
  return role ? { user, role } : null;
}

export async function GET() {
  const who = await member();
  if (!who) return privateJsonResponse({ error: "sign_in_required" }, { status: 401 });
  return privateJsonResponse({ comments: await listComments(), me: who.user.email });
}

export async function POST(request: Request) {
  const who = await member();
  if (!who) return Response.json({ error: "sign_in_required" }, { status: 401 });
  const body = await request.json() as { action?: string; personId?: string; body?: string; commentId?: string };
  try {
    if (body.action === "remove") {
      return Response.json({ comments: await removeComment(String(body.commentId ?? ""), who.user.email, who.role === "admin"), me: who.user.email });
    }
    const comments = await addComment(String(body.personId ?? ""), String(body.body ?? ""), who.user.email, who.user.displayName ?? null);
    return Response.json({ comments, me: who.user.email });
  } catch (error) {
    const code = error instanceof Error ? error.message : "comment_failed";
    return Response.json({ error: code }, { status: code === "comment_required" ? 400 : code === "not_your_comment" ? 403 : 404 });
  }
}
