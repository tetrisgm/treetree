import { getMemberPerson, readTree } from "../../../db/store";
import { requireVisitor } from "../../authz";
import { getAppleUser } from "../../apple-auth";
import { familyFactoids, greetingFact } from "../../../lib/family-facts";
import { interviewLeads } from "../../../lib/interview";
import { archiveCacheHeaders, preventSharedCaching } from "../../../lib/archive-cache";

export const runtime = "edge";

/** What the archive says before it is asked: an anniversary falling today, or
 * a fact about the family, and then a few more facts drawn from the numbers -
 * a reader taps one to have the archivist expand on it. These used to be
 * hand-written openers ("Which records are missing birth dates?"), which read
 * as chores rather than as anything the family would want to know. */
export async function GET() {
  const auth = await requireVisitor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  const tree = await readTree();
  const fact = greetingFact(tree);

  // steady through the day, different tomorrow, and never the one already
  // shown above
  const day = Math.floor(Date.now() / 86_400_000);
  const pool = familyFactoids(tree).filter((candidate) => candidate.ask && candidate.text !== fact?.text);
  const rotated = pool.map((_, index) => pool[(index + day) % pool.length]);
  const factoids = rotated.slice(0, 3).map((candidate) => ({ text: candidate.text, ask: candidate.ask!, personId: candidate.personId ?? null }));

  // the agentic shaky leaf: one gap near the person this member is in the
  // tree - something only they are likely to know - offered before trivia
  let egoId: string | null = null;
  try {
    const user = await getAppleUser();
    egoId = user ? await getMemberPerson(user.email) : null;
  } catch { /* no request cookie store (unit tests call the handler directly): anonymous */ }
  if (egoId) {
    const lead = interviewLeads(tree, [egoId])[0];
    if (lead) {
      factoids.unshift({
        text: `Only the family can fill this in: ${lead.personName} is missing ${lead.missing.slice(0, 2).join(" and ")}.`,
        ask: `Do you know the ${lead.missing[0]} of ${lead.personName}?`,
        personId: null,
      });
      factoids.length = Math.min(factoids.length, 3);
    }
  }

  return Response.json(
    { fact: fact?.text ?? null, personId: fact?.personId ?? null, factoids },
    { headers: egoId ? { "cache-control": "private, no-store" } : archiveCacheHeaders(auth.visibility, "public, max-age=300") },
  );
}
