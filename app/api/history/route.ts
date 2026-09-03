import { listChangeLog, undoChange } from "../../../db/store";
import { requireEditor } from "../../authz";
import { preventSharedCaching, privateJsonResponse } from "../../../lib/archive-cache";

export const runtime = "edge";

/** Everything anyone has changed, newest first. */
export async function GET(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  const before = new URL(request.url).searchParams.get("before");
  return privateJsonResponse(await listChangeLog(before));
}

export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  let body: { changeId?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return privateJsonResponse({ error: "invalid_json" }, { status: 400 }); }
  const changeId = typeof body.changeId === "string" ? body.changeId.trim() : "";
  if (!changeId) return privateJsonResponse({ error: "change_id_required" }, { status: 400 });
  try { return privateJsonResponse({ ok: true, tree: await undoChange(changeId, auth.user.email) }); }
  catch (error) { return privateJsonResponse({ error: error instanceof Error ? error.message : "undo_failed" }, { status: 400 }); }
}
