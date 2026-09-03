/** Per-deployment identity. Every family that deploys this platform names
 * its own archive here instead of inheriting the reference instance's; the
 * values come from Worker vars so one wrangler config carries them all.
 * Server-side only - client components get their strings through i18n. */

export function publicOrigin(): string {
  return (process.env.PUBLIC_ORIGIN || "https://example.com").replace(/\/+$/, "");
}

export function archiveName(): string {
  return (process.env.ARCHIVE_NAME || "").trim() || "Family Archive";
}

/** The deployment's operator, for legal-page contact lines. Same variable
 * that seeds the first admin, so it exists on every working deployment. */
export function ownerEmail(): string {
  return (process.env.OWNER_EMAIL || "").trim().toLowerCase();
}

export function archiveTagline(): string {
  return (process.env.ARCHIVE_TAGLINE || "").trim() || "A living family record, built together.";
}

/** The archive's name per interface language. A family whose name is
 * written differently in another script sets ARCHIVE_NAME_<LANG>
 * (e.g. ARCHIVE_NAME_FA); everything else inherits ARCHIVE_NAME. */
export function archiveNames(languages: readonly string[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const lang of languages) {
    names[lang] = (process.env[`ARCHIVE_NAME_${lang.toUpperCase()}`] || "").trim() || archiveName();
  }
  return names;
}

/** A paragraph the archivist prompts embed describing this family's
 * languages, scripts, and calendars. Written per archive (or by the
 * founder during onboarding); the default assumes nothing. */
export function archivePromptContext(): string {
  return (process.env.ARCHIVE_PROMPT_CONTEXT || "").trim() ||
    "This family's records may span several languages and scripts; the archive holds all of them as written.";
}

/** The origin's host, for identities that must align with the sending
 * domain (SMTP EHLO, Message-ID) or name the deployment (GEDCOM source). */
export function archiveDomain(): string {
  try {
    return new URL(publicOrigin()).hostname;
  } catch {
    return "example.com";
  }
}

/** A filename- and GEDCOM-safe slug of the archive's name. */
export function archiveSlug(): string {
  const slug = archiveName().toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "family-archive";
}
