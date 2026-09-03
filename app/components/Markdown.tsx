import { Fragment, type ReactNode } from "react";

/** The archivist answers in markdown, so the chat has to render it: without
 * this the replies arrive as one run-on line of literal ** and - characters. */
function renderInline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
      if (part.length > 2 && ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_")))) return <em key={index}>{part.slice(1, -1)}</em>;
      return part;
    });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={blocks.length}>{paragraph.map((line, index) => <Fragment key={index}>{index > 0 && <br />}{renderInline(line)}</Fragment>)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{renderInline(item)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    // a blank line ends a paragraph but not a list: models routinely put one
    // between items, and each item would otherwise become its own list
    if (!line.trim()) { flushParagraph(); continue; }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); blocks.push(<p className="md-heading" key={blocks.length}>{renderInline(heading[1])}</p>); continue; }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return <div className="md">{blocks}</div>;
}
