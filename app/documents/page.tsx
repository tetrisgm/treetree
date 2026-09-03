import { listAttachments, listDocumentQueue } from "../../db/store";
import { requireEditor } from "../authz";
import DocumentQueue from "./DocumentQueue";
import { archiveName } from "../../lib/archive-config";

export const dynamic = "force-dynamic";
export function generateMetadata() { return { title: `Documents · ${archiveName()}` }; }

const KB = 1024;
const size = (bytes: number) => bytes > KB * KB ? `${(bytes / (KB * KB)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / KB))} KB`;
const kind = (contentType: string) =>
  contentType.startsWith("image/") ? "Photograph"
    : contentType.includes("zip") ? "Archive"
    : contentType.includes("html") ? "Web page"
    : contentType.includes("pdf") ? "PDF"
    : contentType.includes("word") || contentType.includes("msword") ? "Document"
    : "File";

/** The evidence room: the files the archive was built from, kept private and
 * listed for the editors who maintain it. */
export default async function DocumentsPage() {
  const auth = await requireEditor();
  if (!auth.ok) {
    return (
      <main className="settings-page">
        <header className="settings-masthead">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full page load; client-side Link navigation is unreliable here */}
          <a className="settings-back-pill" href="/">← Back to the family tree</a>
        </header>
        <section className="settings-panel"><h1>Documents</h1>
          <div className="settings-card"><p>The source documents are kept for family editors. Sign in from the <a href="/settings">settings page</a>.</p></div>
        </section>
      </main>
    );
  }
  const [documents, queue] = await Promise.all([listAttachments(), listDocumentQueue()]);
  const images = documents.filter((document) => document.contentType.startsWith("image/"));
  const files = documents.filter((document) => !document.contentType.startsWith("image/"));
  return (
    <main className="settings-page">
      <header className="settings-masthead">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full page load; client-side Link navigation is unreliable here */}
        <a className="settings-back-pill" href="/">← Back to the family tree</a>
      </header>
      <section className="settings-panel">
        <h1>Documents</h1>
        <DocumentQueue initial={queue} />
        <div className="settings-card">
          <p className="settings-hint">The material the archive was built from — the family biography, the histories, the source archive itself. Private to editors, and kept whole: the records elsewhere on this site are what was read out of these.</p>
          {files.length > 0 && <ul className="document-list">
            {files.map((document) => (
              <li key={document.id}>
                <span className="document-kind">{kind(document.contentType)}</span>
                <a className="document-name" href={`/api/photos/${document.id}`}>{document.filename}</a>
                <span className="document-size">{size(document.size)}</span>
              </li>
            ))}
          </ul>}
          {images.length > 0 && <>
            <h2 className="document-heading">Photographs</h2>
            <div className="photo-grid">
              {images.map((image) => (
                <a className="photo-tile" key={image.id} href={`/api/photos/${image.id}`} title={image.filename}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- archive evidence served from R2 */}
                  <img src={`/api/photos/${image.id}`} alt={image.filename} loading="lazy" />
                </a>
              ))}
            </div>
          </>}
          {!documents.length && <p>No source documents have been uploaded yet.</p>}
        </div>
      </section>
    </main>
  );
}
