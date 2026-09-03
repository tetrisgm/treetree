import { answerQuestion, listOpenQuestions } from "../../../db/store";
import { requireEditor } from "../../authz";
import { preventSharedCaching, privateJsonResponse } from "../../../lib/archive-cache";

export async function GET() {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  return privateJsonResponse({ questions: await listOpenQuestions() });
}

export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  const body = await request.json() as { id?: string; verdict?: string; note?: string };
  if (!body.id || (body.verdict !== "confirm" && body.verdict !== "deny")) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const tree = await answerQuestion(body.id, body.verdict, body.note ?? null, auth.user.email);
    return Response.json({ tree, questions: await listOpenQuestions() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "answer_failed";
    const status = code === "question_not_found" ? 404 : code === "question_already_answered" ? 409 : code === "answer_name_required" ? 400 : 500;
    return Response.json({ error: code }, { status });
  }
}
