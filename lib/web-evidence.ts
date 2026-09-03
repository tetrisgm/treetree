/** Web links as evidence.
 *
 * A family member's source is often a URL - an obituary, a memorial page, a
 * cemetery index. The editor chat accepts pasted links: the Worker fetches
 * the page, keeps a plain-text snapshot as a real evidence attachment (so
 * the citation survives link rot), and hands the text to the archivist like
 * any uploaded document. Bounded on purpose: https only, a handful of links
 * per message, one megabyte of text per page.
 */

const MAX_URLS_PER_MESSAGE = 3;
export const MAX_SNAPSHOT_BYTES = 1_000_000;

export function extractEvidenceUrls(message: string): string[] {
  const found = message.match(/https:\/\/[^\s<>"')\]]+/g) ?? [];
  const urls: string[] = [];
  for (const raw of found) {
    const cleaned = raw.replace(/[.,;:!?]+$/, "");
    try {
      const url = new URL(cleaned);
      // https only, and never a bare address - the platform already keeps a
      // Worker off private networks, this keeps intent unambiguous too
      if (url.protocol !== "https:" || /^[\d.:[\]]+$/.test(url.hostname)) continue;
      if (!urls.includes(url.toString())) urls.push(url.toString());
    } catch { /* not a URL after all */ }
    if (urls.length >= MAX_URLS_PER_MESSAGE) break;
  }
  return urls;
}

/** A crude but dependency-free readable-text pass: scripts, styles, and tags
 * out, entities in, whitespace collapsed. Enough for a model to read a page
 * and for a human to recognize the snapshot later. */
export function htmlToEvidenceText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type WebEvidence = { url: string; title: string; text: string };

export async function fetchWebEvidence(url: string): Promise<WebEvidence | { url: string; error: string }> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "family-archive-evidence/1.0 (+source snapshot for a family history record)", accept: "text/html, text/plain" },
    });
    if (!response.ok) return { url, error: `the page answered ${response.status}` };
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(contentType)) return { url, error: `the page is ${contentType.split(";")[0] || "not text"}, not a readable page - upload it as a file instead` };
    const raw = (await response.text()).slice(0, MAX_SNAPSHOT_BYTES * 2);
    const title = raw.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1]?.trim() ?? new URL(url).hostname;
    const text = (contentType.includes("html") ? htmlToEvidenceText(raw) : raw).slice(0, MAX_SNAPSHOT_BYTES);
    if (!text) return { url, error: "the page had no readable text" };
    return { url, title, text };
  } catch {
    return { url, error: "the page could not be fetched" };
  }
}
