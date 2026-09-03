import { cookies } from "next/headers";
import FamilyTreeApp from "./components/FamilyTreeApp";
import { LanguageProvider } from "./components/LanguageContext";
import { LANG_COOKIE, LANGUAGES, parseLang } from "../lib/i18n";
import { archiveName, archiveNames } from "../lib/archive-config";
import { appleSignInPath, appleSignOutPath, getAppleUser } from "./apple-auth";
import { getViewerRole, visitorGate, TEMPORARY_OPEN_EDITOR } from "./authz";
import { getMemberPerson } from "../db/store";
import PasswordGate from "./components/PasswordGate";

export const dynamic = "force-dynamic";

export default async function Home() {
  // The tree is fetched client-side: serializing 400+ people into every
  // server response repeatedly exceeded the Worker CPU limit.
  const user = await getAppleUser();
  const role = user ? await getViewerRole(user) : null;
  const gate = await visitorGate();
  if (gate === "password") {
    return (
      <main className="settings-page visit-gate">
        <section className="settings-panel">
          <p className="eyebrow settings-eyebrow">{archiveName()}</p>
          <h1>A family archive</h1>
          <PasswordGate />
        </section>
      </main>
    );
  }
  if (gate === "sign-in" || gate === "not-a-member") {
    return (
      <main className="settings-page visit-gate">
        <section className="settings-panel">
          <p className="eyebrow settings-eyebrow">{archiveName()}</p>
          <h1>A family archive</h1>
          <div className="settings-card">
            <p>{user
              ? "Your account is signed in but no longer on the member list. Ask a family admin to restore your access."
              : "This archive is shared with the family. Sign in to browse it — first-time visitors are welcomed as viewers."}</p>
            <div className="settings-signin-row">
              {!user && <a className="settings-signin" href={appleSignInPath("/")}> Sign in with Apple</a>}
              {!user && process.env.GOOGLE_CLIENT_ID && <a className="settings-signin is-google" href="/api/auth/google?return_to=%2F"><span aria-hidden="true">G</span> Sign in with Google</a>}
              {user && <a className="settings-signin" href={appleSignOutPath("/")}>Sign out</a>}
            </div>
          </div>
        </section>
      </main>
    );
  }
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  return (
    <LanguageProvider initial={lang} archive={archiveNames(LANGUAGES)}>
      <FamilyTreeApp
        initialTree={null}
        viewer={{ signedIn: Boolean(user), canEdit: TEMPORARY_OPEN_EDITOR || role === "admin" || role === "canEdit", role, displayName: user?.displayName ?? null, personId: user && role ? await getMemberPerson(user.email) : null }}
        signOutPath={appleSignOutPath("/")}
        signInEnabled={!TEMPORARY_OPEN_EDITOR}
      />
    </LanguageProvider>
  );
}
