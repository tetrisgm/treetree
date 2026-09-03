import type { FamilyTree } from "./types";
import type { ChangeEntry } from "../db/store";
import { onThisDay } from "./family-facts";
import { archiveName, publicOrigin } from "./archive-config";

/** What the family would want to hear about since they last looked: who was
 * added, what was answered, which stories arrived, and whose anniversary is
 * coming. Rendered as plain text and as HTML so it can go out by any route. */
export type Digest = {
  since: string;
  headline: string;
  sections: { title: string; lines: string[] }[];
  empty: boolean;
};

const KIND_TITLES: Record<string, string> = {
  add_person: "People added",
  update_person: "Records updated",
  add_story: "Stories added",
  attach_person_photo: "Photographs added",
  link_person_photo: "Photographs added",
  add_comment: "Notes from the family",
  answer_question: "Questions answered",
};

export function buildDigest(tree: FamilyTree, entries: ChangeEntry[], since: Date, today = new Date()): Digest {
  const recent = entries.filter((entry) => new Date(entry.createdAt) >= since);
  const grouped = new Map<string, string[]>();
  for (const entry of recent) {
    const title = KIND_TITLES[entry.kind];
    if (!title) continue;
    const lines = grouped.get(title) ?? [];
    if (lines.length < 12 && !lines.includes(entry.summary)) lines.push(entry.summary);
    grouped.set(title, lines);
  }

  const sections = [...grouped.entries()].map(([title, lines]) => ({ title, lines }));

  // anniversaries in the coming week, so the note arrives before the day
  const upcoming: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    for (const fact of onThisDay(tree, day)) {
      const when = offset === 0 ? "today" : offset === 1 ? "tomorrow" : day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
      upcoming.push(`${when.charAt(0).toUpperCase()}${when.slice(1)}: ${fact.text}`);
    }
  }
  if (upcoming.length) sections.push({ title: "The week ahead", lines: upcoming.slice(0, 10) });

  const added = recent.filter((entry) => entry.kind === "add_person").length;
  const stories = recent.filter((entry) => entry.kind === "add_story").length;
  const headline = added || stories
    ? `${[added && `${added} ${added === 1 ? "person" : "people"}`, stories && `${stories} ${stories === 1 ? "story" : "stories"}`].filter(Boolean).join(" and ")} joined the archive`
    : recent.length
      ? `${recent.length} ${recent.length === 1 ? "change" : "changes"} to the archive`
      : "The archive is quiet this week";

  return { since: since.toISOString().slice(0, 10), headline, sections, empty: !recent.length && !upcoming.length };
}

export function digestText(digest: Digest, origin = publicOrigin()): string {
  const body = digest.sections.map((section) => `${section.title}\n${section.lines.map((line) => `  - ${line}`).join("\n")}`).join("\n\n");
  return `${digest.headline}\n\nSince ${digest.since}\n\n${body || "Nothing has changed."}\n\n${origin}\n`;
}

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);

export function digestHtml(digest: Digest, origin = publicOrigin()): string {
  const sections = digest.sections.map((section) => `
    <h2 style="font:600 15px/1.4 system-ui,sans-serif;color:#1c1c1e;margin:22px 0 6px">${escapeHtml(section.title)}</h2>
    <ul style="margin:0;padding-left:18px">${section.lines.map((line) => `<li style="font:400 14px/1.6 system-ui,sans-serif;color:#3a3a3c">${escapeHtml(line)}</li>`).join("")}</ul>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:26px 28px">
      <p style="font:700 11px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#457156;margin:0 0 8px">${escapeHtml(archiveName())}</p>
      <h1 style="font:600 22px/1.3 Georgia,serif;color:#1c1c1e;margin:0">${escapeHtml(digest.headline)}</h1>
      ${sections || '<p style="font:400 14px/1.6 system-ui,sans-serif;color:#3a3a3c">Nothing has changed this week.</p>'}
      <p style="margin:26px 0 0"><a href="${origin}" style="font:600 14px/1 system-ui,sans-serif;color:#457156">Open the family archive →</a></p>
    </div>
  </body></html>`;
}
