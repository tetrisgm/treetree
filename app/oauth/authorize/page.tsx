import { appleSignInPath, getAppleUser } from "../../apple-auth";
import { getViewerRole } from "../../authz";
import { archiveName } from "../../../lib/archive-config";
import { validateAuthorizeRequest } from "../../../lib/mcp-oauth";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: `Connect an assistant · ${archiveName()}` };
}

/** The consent page an MCP client sends a member to. Approving mints an
 * authorization code bound to this member; the client exchanges it for a
 * bearer token at /oauth/token. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const shell = (content: React.ReactNode) => (
    <main className="settings-page visit-gate">
      <section className="settings-panel">
        <p className="eyebrow settings-eyebrow">{archiveName()}</p>
        <h1>Connect an assistant</h1>
        <div className="settings-card">{content}</div>
      </section>
    </main>
  );

  const validated = await validateAuthorizeRequest(params);
  if (!validated.ok) return shell(<p>{validated.problem}</p>);

  const user = await getAppleUser();
  const role = await getViewerRole(user);
  if (!user || !role) {
    const returnTo = `/oauth/authorize?${params.toString()}`;
    return shell(
      <>
        <p>{user
          ? "Your account is not on this archive's member list, so it cannot connect an assistant. Ask a family admin for access."
          : `Sign in first, so the archive knows which member is connecting ${validated.request.client.name}.`}</p>
        {!user && <div className="settings-signin-row"><a className="settings-signin" href={appleSignInPath(returnTo)}>Sign in with Apple</a></div>}
      </>,
    );
  }

  return shell(
    <>
      <p><strong>{validated.request.client.name}</strong> is asking to {validated.request.scope === "propose" ? "read this family archive and suggest additions" : "read this family archive"} as you ({user.email}).</p>
      <p>{validated.request.scope === "propose"
        ? "It will be able to look up people, relationships, and stories with your member access, and to file proposed additions — new people, links, or stories — which wait for a family editor to review before anything changes. It can never edit, delete, or merge records."
        : "It will be able to look up people, relationships, and stories with your member access — and nothing more: this connection cannot change the archive."} You can end it at any time from Settings, and it ends automatically if you leave the member list.</p>
      <form method="post" action="/oauth/authorize/approve">
        <input type="hidden" name="client_id" value={validated.request.client.clientId} />
        <input type="hidden" name="redirect_uri" value={validated.request.redirectUri} />
        <input type="hidden" name="code_challenge" value={validated.request.codeChallenge} />
        <input type="hidden" name="scope" value={validated.request.scope} />
        {validated.request.state != null && <input type="hidden" name="state" value={validated.request.state} />}
        <div className="settings-signin-row">
          <button className="settings-signin" type="submit" name="decision" value="approve">Approve</button>
          <button className="settings-back-pill" type="submit" name="decision" value="deny">Deny</button>
        </div>
      </form>
    </>,
  );
}
