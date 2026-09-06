import { getMemberPerson, listChangeLog, listMembers, readTree } from "../../../db/store";
import { requireAdmin, requireEditor } from "../../authz";
import { buildDigest, digestHtml, digestQuestions, digestText } from "../../../lib/digest";
import { answerableGaps } from "../../../lib/who-can-answer";
import { sendMail } from "../../../lib/smtp";
import { archiveName } from "../../../lib/archive-config";
import { preventSharedCaching, privateJsonResponse } from "../../../lib/archive-cache";

export const runtime = "edge";

/** The week's news from the archive. Readable now; sending it by email needs
 * a provider key the owner has to create (see docs/HANDOFF.md) - nothing here
 * pretends to deliver mail it cannot send. */
export async function GET(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 7)));
  const since = new Date(Date.now() - days * 86_400_000);
  const [tree, log] = await Promise.all([readTree(), listChangeLog(null, 300)]);
  const digest = buildDigest(tree, log.entries, since);
  /* The reader's own three questions, when the archive knows who they are.
     getMemberPerson resolves a linked identity to its member row, which a
     raw email comparison does not - the owner signs in two ways. */
  const seat = await getMemberPerson(auth.user.email);
  const questions = digestQuestions(tree, seat);
  if (questions.length) digest.sections.push({ title: "Can you help?", lines: questions });
  if (url.searchParams.get("format") === "html") {
    return preventSharedCaching(new Response(digestHtml(digest), { headers: { "content-type": "text/html; charset=utf-8" } }));
  }
  if (url.searchParams.get("format") === "text") {
    return preventSharedCaching(new Response(digestText(digest), { headers: { "content-type": "text/plain; charset=utf-8" } }));
  }
  return privateJsonResponse(digest);
}

/** Send the digest. Admin only, and never automatic: a weekly schedule is the
 * owner's call, not something a deploy should quietly install. */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const smtpUrl = process.env.SMTP_URL;
  const from = process.env.MAIL_FROM;
  if (!smtpUrl || !from) return Response.json({ error: "mail_not_configured" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as { to?: string; days?: number };
  const days = Math.min(90, Math.max(1, Number(body.days ?? 7)));
  const since = new Date(Date.now() - days * 86_400_000);
  const [tree, log, members] = await Promise.all([readTree(), listChangeLog(null, 300), listMembers()]);
  const digest = buildDigest(tree, log.entries, since);
  // an empty week still has questions worth asking, so "nothing to report"
  // only holds when nobody has a seat to be asked about
  const anyQuestions = members.some((member) => digestQuestions(tree, member.personId ?? null).length > 0);
  if (digest.empty && !anyQuestions && !body.to) return Response.json({ sent: 0, reason: "nothing_to_report" });

  // a single address for a test send; otherwise everyone on the member list
  /* A test send goes wherever the admin says - a scratch inbox, a linked
     identity - so `to` is an address, not a filter over the member list. It
     borrows the seat of the member row it matches, if any, so the test shows
     the questions that member would really get. */
  const testTo = typeof body.to === "string" ? body.to.trim().toLowerCase() : null;
  const recipients = testTo
    ? [{ email: testTo, personId: members.find((member) => member.email === testTo)?.personId ?? await getMemberPerson(testTo) }]
    : members;
  if (!recipients.length) return Response.json({ sent: 0, reason: "no_members" });
  /* One letter per member, because the questions are theirs: the archive
     asks each person about the records nearest their own seat in the tree.
     Members with no seat get the news without the questions. */
  /* One letter per member, so each carries its own questions - and one
     failure must not hide the letters that already went out, or the retry
     sends them twice. Failures are named and reported beside the count. */
  const gaps = answerableGaps(tree, recipients.map((member) => member.personId).filter((id): id is string => Boolean(id)));
  let sent = 0;
  const failed: string[] = [];
  for (const member of recipients) {
    const questions = digestQuestions(tree, member.personId ?? null, gaps);
    const theirs = questions.length
      ? { ...digest, sections: [...digest.sections, { title: "Can you help?", lines: questions }], empty: false }
      : digest;
    if (theirs.empty && !testTo) continue;
    try {
      await sendMail(smtpUrl, {
        to: [member.email], from,
        replyTo: process.env.MAIL_REPLY_TO || undefined,
        subject: `${archiveName()} · ${theirs.headline}`,
        text: digestText(theirs),
        html: digestHtml(theirs),
      });
      sent += 1;
    } catch (error) {
      console.warn("Digest send failed", member.email, error instanceof Error ? error.message : "unknown error");
      failed.push(member.email);
    }
  }
  if (failed.length && !sent) return Response.json({ error: "send_failed", failed }, { status: 502 });
  return Response.json({ sent, headline: digest.headline, ...(failed.length ? { failed } : {}) });
}
