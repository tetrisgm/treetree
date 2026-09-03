import { listChangeLog, listMembers, readTree } from "../../../db/store";
import { requireAdmin, requireEditor } from "../../authz";
import { buildDigest, digestHtml, digestText } from "../../../lib/digest";
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
  if (digest.empty && !body.to) return Response.json({ sent: 0, reason: "nothing_to_report" });

  // a single address for a test send; otherwise everyone on the member list
  const recipients = body.to ? [body.to] : members.map((member) => member.email);
  if (!recipients.length) return Response.json({ sent: 0, reason: "no_members" });
  try {
    await sendMail(smtpUrl, {
      to: recipients, from,
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      subject: `${archiveName()} · ${digest.headline}`,
      text: digestText(digest),
      html: digestHtml(digest),
    });
    return Response.json({ sent: recipients.length, headline: digest.headline });
  } catch (error) {
    console.warn("Digest send failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "send_failed" }, { status: 502 });
  }
}
