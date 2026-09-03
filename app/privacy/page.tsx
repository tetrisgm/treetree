import { archiveDomain, archiveName, ownerEmail } from "../../lib/archive-config";

export function generateMetadata() {
  return { title: `Privacy · ${archiveName()}` };
}

export default function PrivacyPage() {
  const name = archiveName();
  const domain = archiveDomain();
  const contact = ownerEmail();
  return (
    <main className="settings-page">
      <header className="settings-masthead">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full page load; client-side Link navigation is unreliable here */}
        <a className="settings-back-pill" href="/">← Back to the family tree</a>
      </header>
      <section className="settings-panel legal-page">
        <h1>Privacy</h1>
        <div className="settings-card">
          <p>{domain} is a private family archive run by the {name} family for its members and relatives. It is not a commercial service and carries no advertising or analytics trackers.</p>
          <h2>What we store</h2>
          <p>The archive holds genealogical records the family contributes: names, dates and places of birth and death, family relationships, biographies, stories, and photographs. If you sign in, we store the email address and display name provided by Apple or Google sign-in, the role a family admin assigns to your account, and an audit log of changes made to the archive.</p>
          <h2>What we do with it</h2>
          <p>This information is used only to present and maintain the family tree and to control who can see and edit it. It is never sold, shared with advertisers, or used to train advertising profiles. Sign-in uses Apple or Google only to confirm your email address; we never see your password.</p>
          <h2>How the archivist reads contributions</h2>
          <p>When an editor asks the archivist a question or uploads unstructured material, the relevant message, file, and current family-tree context are sent to OpenAI to extract the facts the editor requested. Structured GEDCOM files are parsed by the archive first. Uploaded originals remain private evidence in Cloudflare storage; public visitors cannot open source documents. The archive asks OpenAI not to retain these requests for product training.</p>
          <h2>Living relatives</h2>
          <p>On a public archive, visitors who are not family members can see that a living person belongs in the tree, but exact birth dates, places, residence, biography, photographs, and stories linked to that person are hidden. Family members keep the complete view.</p>
          <h2>Ownership, export, and deletion</h2>
          <p>The family owns the material it contributes. An administrator can export the genealogical archive as GEDCOM at any time. Individual records and their dependent links can be deleted from the profile and restored from History; contact the site owner for a complete archive export or whole-archive deletion.</p>
          <h2>Your choices</h2>
          <p>You can disconnect a linked sign-in yourself on the <a href="/settings">settings page</a>. To correct or remove information about you, contact the site owner{contact ? <> at {contact}</> : null}.</p>
        </div>
      </section>
    </main>
  );
}
