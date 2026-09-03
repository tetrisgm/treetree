import { getMemberPerson, readTree } from "../../../db/store";
import { getAppleUser } from "../../apple-auth";
import { intentContext } from "../../../lib/family-answers";
import { modelClient, modelConfigured, modelName } from "../../../lib/model";
import { familyFactoids, onThisDay } from "../../../lib/family-facts";
import { archiveQueryRelationships } from "../../../lib/archive-query-context";
import { isArchiveMember, requireVisitor } from "../../authz";
import { cookies } from "next/headers";
import { LANGUAGE_ENDONYM, LANG_COOKIE, parseLang } from "../../../lib/i18n";
import { limitRequest } from "../../../lib/rate-limit";
import { archiveName, archivePromptContext } from "../../../lib/archive-config";
import { redactLivingDetails } from "../../../lib/living-privacy";

export const runtime = "edge";

const MAX_PUBLIC_REPLY_TOKENS = 1_200;
const PUBLIC_MODEL_TIMEOUT_MS = 30_000;

/** Relationships are graph facts, not prose: computing every pair the question
 * might mean and handing the answers over keeps the model from inventing a
 * cousinhood. Anniversaries and factoids ride along so it can volunteer one. */
function context(tree: Awaited<ReturnType<typeof readTree>>, message: string, egoId: string | null): string {
  const { relationships } = archiveQueryRelationships(tree, message);
  const today = onThisDay(tree).map((fact) => fact.text);
  return [
    relationships.length ? `Computed relationships (authoritative):\n${relationships.join("\n")}` : "",
    today.length ? `Anniversaries today:\n${today.join("\n")}` : "",
    // the intent layer: who is asking, their kinship to everyone mentioned,
    // year snapshots, origins - computed, so the model never derives them
    intentContext(tree, message, egoId),
    `Facts about the archive:\n${familyFactoids(tree).map((fact) => fact.text).join("\n")}`,
  ].filter(Boolean).join("\n\n") + "\n\n";
}

export async function POST(request: Request) {
  const access = await requireVisitor();
  if (!access.ok) return access.response;
  const limited = await limitRequest(request, "public-ai", 30, 60 * 60);
  if (limited) return limited;
  if (!modelConfigured()) return Response.json({ error: "openai_not_configured" }, { status: 503 });
  const body = await request.json() as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message) return Response.json({ error: "empty_message" }, { status: 400 });
  const fullTree = await readTree();
  const tree = access.visibility === "public" && !(await isArchiveMember()) ? redactLivingDetails(fullTree) : fullTree;
  const readerLanguage = LANGUAGE_ENDONYM[parseLang((await cookies()).get(LANG_COOKIE)?.value)];
  // the asker's own place in the tree, when they are a member who has said
  // who they are - "how am I related to..." answers hang on it
  const user = await getAppleUser();
  const egoId = user ? await getMemberPerson(user.email) : null;
  try {
    const response = await modelClient().responses.create({
      model: modelName(),
      max_output_tokens: MAX_PUBLIC_REPLY_TOKENS,
      instructions: `You answer questions about the ${archiveName()} family archive. Use only the supplied tree data. If a fact is absent, say it is not recorded. Never invent relationships, dates, places, or biographies. Do not propose or perform changes. When asked how two people are related, use the precomputed relationships supplied below rather than working it out yourself. The same goes for every "(computed)" block - the asker's identity and kinship, year snapshots, family origins, upcoming dates: those answers are derived from the records and are authoritative. When the context names the person asking, "I", "me", and "my" in the question mean them. Write for a narrow chat column: short paragraphs, each list item on its own line beginning with "- ", and never print internal IDs.

${archivePromptContext()} Understand a question asked in any of the family's languages or a mixture of them, and answer in the language it was asked in - otherwise in ${readerLanguage}. Quote names as the archive spells them rather than translating them.`,
      input: `Question: ${message}\n\n${context(tree, message, egoId)}\nTree data:\n${JSON.stringify(tree)}`,
      store: false,
    }, { timeout: PUBLIC_MODEL_TIMEOUT_MS, maxRetries: 1 });
    return Response.json({ reply: response.output_text.trim() || "That detail is not recorded in the archive." });
  } catch (error) {
    console.warn("Public archive question failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "agent_failed" }, { status: 502 });
  }
}
