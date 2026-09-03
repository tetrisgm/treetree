import { env, waitUntil } from "cloudflare:workers";
import type { Attachment, ChangeProposal, EvidenceClaim, FamilyTree, OpenQuestion, Person, Relationship, Story } from "../lib/types";
import { safeAttachmentContentType } from "../lib/attachment-types";
import { isChangeProposal } from "../lib/change-proposal";
import { runRecordChecks } from "../lib/record-checks";
import {
  deferObjectDeletionRetries,
  finalizeQueuedObjectDeletion,
  OBJECT_DELETION_RETRY_BATCH_SIZE,
  persistAttachmentMetadataWithCompensation,
  prepareAttachmentDeletion,
  prepareUnreferencedAttachmentCompensation,
  retryQueuedObjectDeletionBatch,
} from "./attachment-deletion";
import { LEGACY_MEMBER_ROLE_MIGRATION_SQL, MEMBERS_PERSON_INDEX_SQL } from "./legacy-migrations";
import { MutationInvariants } from "./mutation-invariants";
import { preparePersonDeletion } from "./person-deletion";
import { CLAIM_QUESTION_ANSWER_SQL, RUNTIME_INTEGRITY_SCHEMA } from "./runtime-integrity";
import { createSingleFlightInitializer, ensureColumns } from "./schema-initialization";
import {
  isD1DailyReadLimitError, MEMBERS_SNAPSHOT_OBJECT_KEY, parseMemberAccessSnapshot,
  nextUtcMidnight, parseTreeSnapshot, parseVisibilitySnapshot, TREE_SNAPSHOT_OBJECT_KEY, VISIBILITY_SNAPSHOT_OBJECT_KEY,
} from "../lib/tree-snapshot";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY, display_name TEXT NOT NULL, gender TEXT CHECK(gender IN ('male', 'female')), given_name TEXT, family_name TEXT,
    birth_date TEXT, death_date TEXT, birth_place TEXT, death_place TEXT, birth_city TEXT, birth_country TEXT, death_city TEXT, death_country TEXT, biography TEXT, photo_attachment_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY, from_person_id TEXT NOT NULL, to_person_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('parent', 'spouse')), created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_unique ON relationships(from_person_id, to_person_id, type)`,
  `CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, date TEXT, place TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS story_people (story_id TEXT NOT NULL, person_id TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_story_people_unique ON story_people(story_id, person_id)`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY, object_key TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL,
    size INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS story_attachments (story_id TEXT NOT NULL, attachment_id TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_story_attachments_unique ON story_attachments(story_id, attachment_id)`,
  `CREATE TABLE IF NOT EXISTS person_comments (
    id TEXT PRIMARY KEY, person_id TEXT NOT NULL, author_email TEXT NOT NULL, author_name TEXT,
    body TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_person_comments_person ON person_comments(person_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS person_photos (
    person_id TEXT NOT NULL, attachment_id TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_person_photos_unique ON person_photos(person_id, attachment_id)`,
  `CREATE TABLE IF NOT EXISTS open_questions (
    id TEXT PRIMARY KEY, question TEXT NOT NULL, evidence TEXT, action_summary TEXT,
    proposal_json TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'confirmed', 'denied')),
    answer_note TEXT, answered_by TEXT, answered_at TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS change_log (
    id TEXT PRIMARY KEY, actor_email TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin', 'canEdit', 'canView')),
    person_id TEXT, added_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS member_links (
    email TEXT PRIMARY KEY, member_email TEXT NOT NULL, provider TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS document_queue (
    id TEXT PRIMARY KEY, attachment_id TEXT NOT NULL, filename TEXT NOT NULL,
    uploaded_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'reading', 'read', 'failed')),
    result TEXT, created_at TEXT NOT NULL, processed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_document_queue_status ON document_queue(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS object_deletion_queue (
    object_key TEXT PRIMARY KEY, queued_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS evidence_claims (
    id TEXT PRIMARY KEY, subject_type TEXT NOT NULL CHECK(subject_type IN ('person', 'relationship')),
    subject_id TEXT NOT NULL, predicate TEXT NOT NULL, value TEXT,
    status TEXT NOT NULL DEFAULT 'preferred' CHECK(status IN ('preferred', 'disputed', 'rejected')),
    confidence INTEGER NOT NULL DEFAULT 100 CHECK(confidence BETWEEN 0 AND 100),
    source_type TEXT NOT NULL CHECK(source_type IN ('manual', 'family_assertion', 'attachment', 'agent', 'import')),
    attachment_id TEXT, source_label TEXT NOT NULL, source_locator TEXT, source_excerpt TEXT,
    created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_claims_subject ON evidence_claims(subject_type, subject_id, predicate, status)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_claims_attachment ON evidence_claims(attachment_id)`,
  `CREATE TABLE IF NOT EXISTS undo_entries (
    change_id TEXT PRIMARY KEY, inverse_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'undoing', 'undone')),
    undone_by TEXT, undone_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS merge_snapshots (
    change_id TEXT PRIMARY KEY, source_person_id TEXT NOT NULL, target_person_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, merged_at TEXT NOT NULL, restored_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS person_deletion_snapshots (
    change_id TEXT PRIMARY KEY, person_id TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    deleted_at TEXT NOT NULL, restored_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL)`,
  // Hosted MCP: dynamically registered OAuth clients, single-use PKCE codes,
  // and the bearer tokens external agents present. Tokens are stored hashed.
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_codes (
    code_hash TEXT PRIMARY KEY, member_email TEXT NOT NULL, client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, scope TEXT NOT NULL,
    expires_at TEXT NOT NULL, consumed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS agent_tokens (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, member_email TEXT NOT NULL,
    client_id TEXT NOT NULL, client_name TEXT NOT NULL, scope TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_tokens_member ON agent_tokens(member_email, revoked_at)`,
  // A connection is a token family: short-lived access tokens hang off it,
  // refresh tokens rotate inside it, and reusing a consumed refresh token
  // (a replay) revokes the whole family and everything it issued.
  `CREATE TABLE IF NOT EXISTS agent_token_families (
    id TEXT PRIMARY KEY, member_email TEXT NOT NULL, client_id TEXT NOT NULL, client_name TEXT NOT NULL,
    scope TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
    absolute_expires_at TEXT NOT NULL, inactivity_expires_at TEXT NOT NULL,
    revoked_at TEXT, replay_detected_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_token_families_member ON agent_token_families(member_email, revoked_at)`,
  `CREATE TABLE IF NOT EXISTS agent_refresh_tokens (
    id TEXT PRIMARY KEY, family_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    access_token_id TEXT NOT NULL, created_at TEXT NOT NULL, consumed_at TEXT
  )`,
  // Changes external agents propose over MCP. Nothing here touches the tree
  // until an editor applies it through the same audited applyProposal path
  // every other mutation takes.
  `CREATE TABLE IF NOT EXISTS agent_proposals (
    id TEXT PRIMARY KEY, proposal_json TEXT NOT NULL, summary TEXT NOT NULL,
    submitted_by TEXT NOT NULL, client_name TEXT NOT NULL, note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'applied', 'rejected')),
    created_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_proposals_status ON agent_proposals(status, created_at)`,
];

type CompatibilityTable = "people" | "relationships" | "members" | "stories";

async function compatibilityColumns(table: CompatibilityTable) {
  const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set(result.results.map(({ name }) => name));
}

async function ensureTextColumns(table: CompatibilityTable, columns: readonly string[]) {
  await ensureColumns(columns, {
    listColumns: () => compatibilityColumns(table),
    addColumn: async (column) => {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`).run();
    },
  });
}

async function initializeSchema() {
  await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));
  await ensureTextColumns("people", ["birth_city", "birth_country", "death_city", "death_country", "gender", "maiden_name", "burial_place", "residence"]);
  await ensureTextColumns("relationships", ["status"]);
  // Which person in the tree an account belongs to, so the archive can open
  // where that person stands rather than at the founders.
  await ensureTextColumns("members", ["person_id"]);
  // Imported archive material is written in its own language; body holds the
  // English a reader sees first, original_body the words the family wrote.
  await ensureTextColumns("stories", ["original_body"]);
  // The roles are named for what they let a person do - canView, canEdit,
  // admin - and older databases carry 'viewer' and 'editor' under a CHECK
  // constraint SQLite cannot alter, so the table is rebuilt once and the
  // values mapped across.
  const membersSchema = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='members'").first<{ sql: string }>();
  if (membersSchema && !membersSchema.sql.includes("'canView'")) {
    // A prior interrupted deployment may already have triggers that reference
    // members. SQLite refuses to rebuild the table while those references
    // would be temporarily invalid, so remove and reinstall them atomically
    // around the one-time migration.
    await env.DB.batch([
      env.DB.prepare("DROP TRIGGER IF EXISTS people_restrict_delete"),
      env.DB.prepare("DROP TRIGGER IF EXISTS members_validate_person_insert"),
      env.DB.prepare("DROP TRIGGER IF EXISTS members_validate_person_update"),
      ...LEGACY_MEMBER_ROLE_MIGRATION_SQL.map((sql) => env.DB.prepare(sql)),
    ]);
  }
  // claimMemberPerson checks this too, but a check followed by a write is not
  // atomic. Recreate the index after the legacy rebuild because dropping the
  // old table also drops its indexes. Duplicate claims must stop startup rather
  // than silently weakening this invariant.
  await env.DB.prepare(MEMBERS_PERSON_INDEX_SQL).run();
  // databases created before refresh rotation lack the family column
  await ensureColumns(["family_id"], {
    listColumns: async () => new Set((await env.DB.prepare("PRAGMA table_info(agent_tokens)").all<{ name: string }>()).results.map(({ name }) => name)),
    addColumn: async (column) => { await env.DB.prepare(`ALTER TABLE agent_tokens ADD COLUMN ${column} TEXT`).run(); },
  });
  // Install triggers only after the legacy members rebuild. DROP TABLE also
  // drops that table's triggers, and older databases still take this path.
  await env.DB.batch(RUNTIME_INTEGRITY_SCHEMA.map((sql) => env.DB.prepare(sql)));
  // First run seeds the member list: the deployment's owner as admin, plus
  // any emails the old EDITOR_EMAILS allow-list carried, as editors. The
  // owner comes from OWNER_EMAIL - an empty members table with no owner
  // configured must stop startup, because seeding nobody (or somebody
  // else's address) locks the deployer out of their own archive.
  const memberCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM members").first<{ count: number }>();
  if (!memberCount?.count) {
    const owner = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
    if (!owner) throw new Error("owner_email_not_configured");
    const now = new Date().toISOString();
    const seeds: [string, "admin" | "canEdit"][] = [[owner, "admin"]];
    for (const email of (process.env.EDITOR_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)) {
      if (!seeds.some(([seeded]) => seeded === email)) seeds.push([email, "canEdit"]);
    }
    await env.DB.batch(seeds.map(([email, role]) =>
      env.DB.prepare("INSERT OR IGNORE INTO members (email, role, added_by, created_at, updated_at) VALUES (?, ?, 'seed', ?, ?)").bind(email, role, now, now)));
  }
  await env.DB.prepare("PRAGMA optimize").run();
}

const initializeSchemaOnce = createSingleFlightInitializer(initializeSchema);

export const ensureSchema = () => initializeSchemaOnce();

export type MemberRole = "admin" | "canEdit" | "canView";

export type SiteVisibility = "public" | "members" | "password";
let visibilityCache: { value: SiteVisibility; time: number } | null = null;
let d1ReadBlockedUntil = 0;

function d1ReadCircuitOpen() {
  return Date.now() < d1ReadBlockedUntil;
}

function openD1ReadCircuit() {
  d1ReadBlockedUntil = nextUtcMidnight();
}

/** "public": anyone can visit. "members": visitors must sign in (every first
 * sign-in auto-registers someone who can view, so the member list is the
 * guest book and admins can raise or remove anyone). "password": anyone with
 * the family's shared password, or the private link, or a place on the
 * member list. */
export async function getSiteVisibility(fresh = false): Promise<SiteVisibility> {
  // The cache is per-isolate, so a write in one isolate leaves another
  // holding the old answer for up to ten seconds. That is fine for deciding
  // whether to let a reader in; it is not fine for a decision that changes
  // who can see the archive, so those ask for a fresh read.
  if (!fresh && visibilityCache && Date.now() - visibilityCache.time < 10_000) return visibilityCache.value;
  let value: SiteVisibility;
  if (d1ReadCircuitOpen()) {
    const object = await env.FILES.get(VISIBILITY_SNAPSHOT_OBJECT_KEY);
    const snapshot = parseVisibilitySnapshot(object ? await object.text() : "");
    if (!snapshot) throw new Error("site_visibility_snapshot_unavailable");
    visibilityCache = { value: snapshot, time: Date.now() };
    return snapshot;
  }
  try {
    await ensureSchema();
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'visibility'").first<{ value: string }>();
    value = row?.value === "members" ? "members" : row?.value === "password" ? "password" : "public";
    waitUntil(env.FILES.put(VISIBILITY_SNAPSHOT_OBJECT_KEY, value, { httpMetadata: { contentType: "text/plain" } }));
  } catch (error) {
    if (!isD1DailyReadLimitError(error)) throw error;
    openD1ReadCircuit();
    console.warn("d1_quota_fallback_site_visibility");
    const object = await env.FILES.get(VISIBILITY_SNAPSHOT_OBJECT_KEY);
    const snapshot = parseVisibilitySnapshot(object ? await object.text() : "");
    if (!snapshot) throw error;
    value = snapshot;
  }
  visibilityCache = { value, time: Date.now() };
  return value;
}

/* The shared password and the private link.
 *
 * The password is only ever kept as the keyed digest lib/access.ts produces:
 * nothing here can return it, because nothing here has it. The share token is
 * a secret in the same sense - it is returned to admins so they can copy the
 * link, and to nobody else. */

async function readSetting(key: string): Promise<string | null> {
  await ensureSchema();
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string, actorEmail: string, summary: string) {
  await ensureSchema();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, value, now),
    // the payload records that it happened, never what was set
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "site_access", summary, JSON.stringify({ setting: key }), now),
  ]);
}

export const accessPasswordDigest = () => readSetting("access_password");
export const hasAccessPassword = async () => Boolean(await readSetting("access_password"));

export async function setAccessPasswordDigest(digest: string, actorEmail: string) {
  await writeSetting("access_password", digest, actorEmail, "Set the family password");
}

export async function clearAccessPassword(actorEmail: string) {
  await ensureSchema();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM site_settings WHERE key = 'access_password'"),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "site_access", "Removed the family password", JSON.stringify({ setting: "access_password" }), now),
  ]);
}

export const shareToken = () => readSetting("access_share_token");

export async function setShareToken(token: string, actorEmail: string) {
  await writeSetting("access_share_token", token, actorEmail, "Made a new private link");
}

export async function setSiteVisibility(value: SiteVisibility, actorEmail: string) {
  await ensureSchema();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('visibility', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(value, now),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "site_visibility", value === "members" ? "Restricted the site to signed-in members" : value === "password" ? "Put the site behind the family password" : "Opened the site to anyone with the link", JSON.stringify({ visibility: value }), now),
  ]);
  visibilityCache = { value, time: Date.now() };
}

/** First sign-in of an unknown identity registers it as a viewer, so every
 * account exists in the member list for admins to see and promote. */
export async function registerViewer(email: string) {
  // "Only people I add": while the site is members-only, sign-ins do not
  // self-register - the admins add each email themselves.
  if ((await getSiteVisibility()) === "members") return;
  const canonical = await resolveMemberEmail(email);
  const existing = await env.DB.prepare("SELECT role FROM members WHERE email = ?").bind(canonical).first<{ role: MemberRole }>();
  if (existing) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO members (email, role, added_by, created_at, updated_at) VALUES (?, 'canView', 'sign-up', ?, ?)").bind(canonical, now, now),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), canonical, "member_signup", `${canonical} signed in for the first time and can view the archive`, JSON.stringify({ email: canonical, role: "viewer" }), now),
  ]);
}
export type MemberIdentity = { email: string; provider: string | null };
export type Member = { email: string; role: MemberRole; addedBy: string; createdAt: string; links: MemberIdentity[] };

export async function listMembers(): Promise<Member[]> {
  if (d1ReadCircuitOpen()) {
    const snapshot = await memberAccessSnapshot();
    if (!snapshot) throw new Error("member_access_snapshot_unavailable");
    return snapshot.members.map((member) => ({ email: member.email, role: member.role, addedBy: "snapshot", createdAt: "", links: snapshot.links.filter((link) => link.memberEmail === member.email && link.email !== member.email).map(({ email, provider }) => ({ email, provider })) }));
  }
  try {
    await ensureSchema();
    const [members, links, accessMembers] = await Promise.all([
      env.DB.prepare("SELECT email, role, added_by AS addedBy, created_at AS createdAt FROM members ORDER BY role, email").all<Omit<Member, "links">>(),
      env.DB.prepare("SELECT email, member_email AS memberEmail, provider FROM member_links ORDER BY created_at").all<{ email: string; memberEmail: string; provider: string | null }>(),
      env.DB.prepare("SELECT email, role, person_id AS personId FROM members ORDER BY email").all<{ email: string; role: MemberRole; personId: string | null }>(),
    ]);
    waitUntil(env.FILES.put(MEMBERS_SNAPSHOT_OBJECT_KEY, JSON.stringify({ members: accessMembers.results, links: links.results }), { httpMetadata: { contentType: "application/json" } }));
    return members.results.map((member) => ({
      ...member,
      links: links.results.filter((link) => link.memberEmail === member.email && link.email !== member.email).map((link) => ({ email: link.email, provider: link.provider })),
    }));
  } catch (error) {
    if (!isD1DailyReadLimitError(error)) throw error;
    openD1ReadCircuit();
    console.warn("d1_quota_fallback_member_list");
    const snapshot = await memberAccessSnapshot();
    if (!snapshot) throw error;
    return snapshot.members.map((member) => ({ email: member.email, role: member.role, addedBy: "snapshot", createdAt: "", links: snapshot.links.filter((link) => link.memberEmail === member.email && link.email !== member.email).map(({ email, provider }) => ({ email, provider })) }));
  }
}

async function memberAccessSnapshot() {
  const object = await env.FILES.get(MEMBERS_SNAPSHOT_OBJECT_KEY);
  return object ? parseMemberAccessSnapshot(await object.text()) : null;
}

/** A sign-in email resolves through member_links to the canonical account
 * email — one person, several providers, one member row. */
export async function resolveMemberEmail(email: string): Promise<string> {
  const normalized = email.toLowerCase();
  if (d1ReadCircuitOpen()) return (await memberAccessSnapshot())?.links.find((link) => link.email === normalized)?.memberEmail ?? normalized;
  try {
    await ensureSchema();
    const row = await env.DB.prepare("SELECT member_email AS memberEmail FROM member_links WHERE email = ?").bind(normalized).first<{ memberEmail: string }>();
    return row?.memberEmail ?? normalized;
  } catch (error) {
    if (!isD1DailyReadLimitError(error)) throw error;
    openD1ReadCircuit();
    console.warn("d1_quota_fallback_member_resolution");
    return (await memberAccessSnapshot())?.links.find((link) => link.email === normalized)?.memberEmail ?? normalized;
  }
}

export async function listLinksFor(memberEmail: string): Promise<MemberIdentity[]> {
  await ensureSchema();
  const result = await env.DB.prepare("SELECT email, provider FROM member_links WHERE member_email = ? AND email != member_email ORDER BY created_at").bind(memberEmail.toLowerCase()).all<MemberIdentity>();
  return result.results;
}

/** Every provider this account has signed in with - from link rows and the
 * self-row that recordSignInProvider keeps for the primary identity. */
export async function listConnectedProviders(memberEmail: string): Promise<string[]> {
  await ensureSchema();
  const result = await env.DB.prepare("SELECT DISTINCT provider FROM member_links WHERE member_email = ? AND provider IS NOT NULL").bind(memberEmail.toLowerCase()).all<{ provider: string }>();
  return result.results.map((row) => row.provider);
}

/** A self-row (email = member_email) records which provider an identity uses
 * without affecting resolution; linkIdentity re-points it when the identity
 * later joins another account. */
export async function recordSignInProvider(email: string, provider: string) {
  await ensureSchema();
  const normalized = email.toLowerCase();
  const canonical = await resolveMemberEmail(normalized);
  await env.DB.prepare(`INSERT INTO member_links (email, member_email, provider, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET provider = excluded.provider`).bind(normalized, canonical, provider, new Date().toISOString()).run();
}

/** Who a signed-in account is in the tree. Null until they say so. */
export async function getMemberPerson(email: string): Promise<string | null> {
  const canonical = await resolveMemberEmail(email);
  if (d1ReadCircuitOpen()) return (await memberAccessSnapshot())?.members.find((member) => member.email === canonical)?.personId ?? null;
  try {
    await ensureSchema();
    const row = await env.DB.prepare("SELECT person_id AS personId FROM members WHERE email = ?").bind(canonical).first<{ personId: string | null }>();
    return row?.personId ?? null;
  } catch (error) {
    if (!isD1DailyReadLimitError(error)) throw error;
    openD1ReadCircuit();
    console.warn("d1_quota_fallback_member_person");
    return (await memberAccessSnapshot())?.members.find((member) => member.email === canonical)?.personId ?? null;
  }
}

/** A person can be claimed by one account: two people sharing a record would
 * make "where I stand in the tree" meaningless for both. */
export async function claimMemberPerson(email: string, personId: string | null): Promise<"ok" | "taken" | "unknown_person"> {
  await ensureSchema();
  const canonical = await resolveMemberEmail(email);
  const now = new Date().toISOString();
  if (personId) {
    const person = await env.DB.prepare("SELECT display_name AS name FROM people WHERE id = ?").bind(personId).first<{ name: string }>();
    if (!person) return "unknown_person";
    const held = await env.DB.prepare("SELECT email FROM members WHERE person_id = ? AND email <> ?").bind(personId, canonical).first<{ email: string }>();
    if (held) return "taken";
    await env.DB.batch([
      env.DB.prepare("UPDATE members SET person_id = ?, updated_at = ? WHERE email = ?").bind(personId, now, canonical),
      env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), canonical, "member_identity", `${canonical} is ${person.name} in the tree`, JSON.stringify({ personId }), now),
    ]);
    return "ok";
  }
  await env.DB.prepare("UPDATE members SET person_id = NULL, updated_at = ? WHERE email = ?").bind(now, canonical).run();
  return "ok";
}

export async function getMemberRole(email: string): Promise<MemberRole | null> {
  const canonical = await resolveMemberEmail(email);
  if (d1ReadCircuitOpen()) return (await memberAccessSnapshot())?.members.find((member) => member.email === canonical)?.role ?? null;
  try {
    const row = await env.DB.prepare("SELECT role FROM members WHERE email = ?").bind(canonical).first<{ role: MemberRole }>();
    return row?.role ?? null;
  } catch (error) {
    if (!isD1DailyReadLimitError(error)) throw error;
    openD1ReadCircuit();
    console.warn("d1_quota_fallback_member_role");
    return (await memberAccessSnapshot())?.members.find((member) => member.email === canonical)?.role ?? null;
  }
}

/** Attach identityEmail to memberEmail's account. If identityEmail is itself
 * a member row, the two accounts merge: the target keeps the higher role, the
 * identity row dissolves into a link, and any links it held are re-pointed so
 * chains never form. */
export async function linkIdentity(identityEmail: string, memberEmail: string, provider: string | null, actorEmail: string) {
  await ensureSchema();
  const identity = identityEmail.toLowerCase();
  const canonical = await resolveMemberEmail(memberEmail);
  if (identity === canonical) return;
  const existing = await env.DB.prepare("SELECT member_email AS memberEmail FROM member_links WHERE email = ?").bind(identity).first<{ memberEmail: string }>();
  if (existing) {
    if (existing.memberEmail === canonical) return;
    if (existing.memberEmail !== identity) throw new Error("identity_linked_elsewhere");
  }
  const now = new Date().toISOString();
  const identityRow = await env.DB.prepare("SELECT role FROM members WHERE email = ?").bind(identity).first<{ role: MemberRole }>();
  const statements = [];
  if (identityRow) {
    statements.push(env.DB.prepare(`INSERT INTO members (email, role, added_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET role = CASE WHEN excluded.role = 'admin' THEN 'admin' ELSE members.role END, updated_at = excluded.updated_at`)
      .bind(canonical, identityRow.role, actorEmail, now, now));
    statements.push(env.DB.prepare("UPDATE member_links SET member_email = ? WHERE member_email = ?").bind(canonical, identity));
    statements.push(env.DB.prepare("DELETE FROM members WHERE email = ?").bind(identity));
  }
  statements.push(env.DB.prepare(`INSERT INTO member_links (email, member_email, provider, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET member_email = excluded.member_email, provider = COALESCE(member_links.provider, excluded.provider)`).bind(identity, canonical, provider, now));
  statements.push(env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actorEmail, "member_link", `Linked ${identity} to ${canonical} as one account`, JSON.stringify({ email: identity, memberEmail: canonical, provider, merged: Boolean(identityRow) }), now));
  await env.DB.batch(statements);
}

export async function unlinkIdentity(identityEmail: string, actorEmail: string) {
  await ensureSchema();
  const identity = identityEmail.toLowerCase();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM member_links WHERE email = ?").bind(identity),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "member_unlink", `Unlinked ${identity} from its account`, JSON.stringify({ email: identity }), now),
  ]);
}

export async function upsertMember(email: string, role: MemberRole, actorEmail: string) {
  await ensureSchema();
  const normalized = email.toLowerCase();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO members (email, role, added_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`).bind(normalized, role, actorEmail, now, now),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "member_set", `Gave ${normalized} the ${role} role`, JSON.stringify({ email: normalized, role }), now),
  ]);
}

export async function removeMember(email: string, actorEmail: string) {
  await ensureSchema();
  const normalized = email.toLowerCase();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM members WHERE email = ?").bind(normalized),
    env.DB.prepare("DELETE FROM member_links WHERE member_email = ?").bind(normalized),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "member_remove", `Removed ${normalized} from the member list`, JSON.stringify({ email: normalized }), now),
  ]);
}

/** Atomic fixed-window limiter. The caller supplies an irreversible request
 * fingerprint, never a raw IP address. */
export async function consumeRateLimit(bucket: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> {
  await ensureSchema();
  const now = Date.now();
  const expiresAt = new Date(now + windowSeconds * 1000).toISOString();
  const row = await env.DB.prepare(`INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET
      count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING count, expires_at AS expiresAt`)
    .bind(bucket, expiresAt, new Date(now).toISOString(), new Date(now).toISOString())
    .first<{ count: number; expiresAt: string }>();
  if (!row) throw new Error("rate_limit_unavailable");
  return { allowed: row.count <= limit, retryAfter: Math.max(1, Math.ceil((Date.parse(row.expiresAt) - now) / 1000)) };
}

// Serialized-tree cache: the public tree endpoint is hit constantly and the
// Worker CPU budget is tight, so the JSON built by the latest readTree() is
// reused for a few seconds. Mutations end in readTree(), which refreshes it.
let treeJsonCache: { body: string; time: number } | null = null;
export function cachedTreeJson(): string | null {
  return treeJsonCache && Date.now() - treeJsonCache.time < 10_000 ? treeJsonCache.body : null;
}

export async function readTree(): Promise<FamilyTree> {
  if (d1ReadCircuitOpen()) {
    const object = await env.FILES.get(TREE_SNAPSHOT_OBJECT_KEY);
    const snapshot = object ? parseTreeSnapshot(await object.text()) : null;
    if (!snapshot) throw new Error("tree_snapshot_unavailable");
    treeJsonCache = { body: JSON.stringify(snapshot), time: Date.now() };
    return snapshot;
  }
  try {
    return await readTreeFromDatabase();
  } catch (error) {
    if (!isD1DailyReadLimitError(error)) throw error;
    openD1ReadCircuit();
    const object = await env.FILES.get(TREE_SNAPSHOT_OBJECT_KEY);
    const snapshot = object ? parseTreeSnapshot(await object.text()) : null;
    if (!snapshot) throw error;
    treeJsonCache = { body: JSON.stringify(snapshot), time: Date.now() };
    console.warn("d1_daily_read_limit_tree_snapshot_served");
    return snapshot;
  }
}

async function readTreeFromDatabase(): Promise<FamilyTree> {
  await ensureSchema();
  const [peopleResult, relationshipsResult, storiesResult, storyPeopleResult, storyAttachmentsResult, personPhotosResult, rootPersonResult] = await Promise.all([
    env.DB.prepare(`SELECT id, display_name AS displayName, gender, given_name AS givenName,
      family_name AS familyName, maiden_name AS maidenName, birth_date AS birthDate, death_date AS deathDate,
      birth_place AS birthPlace, death_place AS deathPlace, birth_city AS birthCity, birth_country AS birthCountry,
      death_city AS deathCity, death_country AS deathCountry, burial_place AS burialPlace, residence, biography, photo_attachment_id AS photoAttachmentId FROM people ORDER BY display_name`).all<Person>(),
    env.DB.prepare(`SELECT id, from_person_id AS fromPersonId, to_person_id AS toPersonId,
      type, status FROM relationships ORDER BY created_at`).all<Relationship>(),
    env.DB.prepare(`SELECT id, title, body, original_body AS originalBody, date, place FROM stories ORDER BY created_at DESC`).all<Omit<Story, "personIds">>(),
    env.DB.prepare(`SELECT story_id AS storyId, person_id AS personId FROM story_people`).all<{ storyId: string; personId: string }>(),
    env.DB.prepare(`SELECT story_id AS storyId, attachment_id AS attachmentId FROM story_attachments`).all<{ storyId: string; attachmentId: string }>(),
    env.DB.prepare(`SELECT person_id AS personId, attachment_id AS attachmentId FROM person_photos ORDER BY created_at`).all<{ personId: string; attachmentId: string }>(),
    env.DB.prepare("SELECT value FROM site_settings WHERE key = 'root_person_id'").first<{ value: string }>(),
  ]);
  const links = new Map<string, string[]>();
  for (const row of storyPeopleResult.results) links.set(row.storyId, [...(links.get(row.storyId) ?? []), row.personId]);
  const attachmentLinks = new Map<string, string[]>();
  for (const row of storyAttachmentsResult.results) attachmentLinks.set(row.storyId, [...(attachmentLinks.get(row.storyId) ?? []), row.attachmentId]);
  // a photo can belong to several people (group photographs); the portrait
  // always leads the gallery
  const photoLinks = new Map<string, string[]>();
  for (const row of personPhotosResult.results) photoLinks.set(row.personId, [...(photoLinks.get(row.personId) ?? []), row.attachmentId]);
  const tree: FamilyTree = {
    people: peopleResult.results.map((person) => {
      const gallery = photoLinks.get(person.id) ?? [];
      const ordered = person.photoAttachmentId ? [person.photoAttachmentId, ...gallery.filter((id) => id !== person.photoAttachmentId)] : gallery;
      return { ...person, photoIds: ordered };
    }),
    relationships: relationshipsResult.results,
    stories: storiesResult.results.map((story) => ({ ...story, personIds: links.get(story.id) ?? [], attachmentIds: attachmentLinks.get(story.id) ?? [] })),
    rootPersonId: rootPersonResult?.value ?? null,
  };
  treeJsonCache = { body: JSON.stringify(tree), time: Date.now() };
  waitUntil(env.FILES.put(TREE_SNAPSHOT_OBJECT_KEY, treeJsonCache.body, {
    httpMetadata: { contentType: "application/json" },
  }));
  return tree;
}

export async function saveAttachment(file: File, actorEmail: string): Promise<Attachment> {
  await ensureSchema();
  const id = crypto.randomUUID();
  const objectKey = `evidence/${id}`;
  const prefix = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const contentType = safeAttachmentContentType(prefix, file.type);
  await env.FILES.put(objectKey, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { filename: file.name },
  });
  const now = new Date().toISOString();
  await persistAttachmentMetadataWithCompensation(objectKey, {
    persistMetadata: async () => {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO attachments
          (id, object_key, filename, content_type, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, objectKey, file.name, contentType, file.size, actorEmail, now),
        env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), actorEmail, "upload_attachment", `Uploaded ${file.name}`, JSON.stringify({ attachmentId: id, filename: file.name, contentType, size: file.size }), now),
      ]);
    },
    metadataExists: async () => Boolean(await env.DB.prepare("SELECT id FROM attachments WHERE id = ?")
      .bind(id).first<{ id: string }>()),
    deleteObject: (key) => env.FILES.delete(key),
    queueObjectDeletion: async (key) => {
      await env.DB.prepare(`INSERT OR IGNORE INTO object_deletion_queue (object_key, queued_at)
        SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM attachments WHERE object_key = ?)`)
        .bind(key, new Date().toISOString(), key).run();
    },
    reportAmbiguousPersistence: ({ objectKey: failedKey, verificationError }) => {
      console.error(JSON.stringify({
        message: verificationError === undefined
          ? "attachment metadata may have committed despite a rejected batch; preserving R2 object"
          : "attachment metadata failure could not be verified; preserving possible live R2 object",
        objectKey: failedKey,
        ...(verificationError === undefined ? {} : {
          verificationError: verificationError instanceof Error ? verificationError.message : String(verificationError),
        }),
      }));
    },
    reportDeferredCleanup: ({ deleteError, objectKey: failedKey, queueError }) => {
      console.error(JSON.stringify({
        message: queueError
          ? "attachment upload compensation could not be queued"
          : "attachment upload compensation queued after R2 deletion failed",
        objectKey: failedKey,
        deleteError: deleteError instanceof Error ? deleteError.message : String(deleteError),
        ...(queueError === undefined ? {} : { queueError: queueError instanceof Error ? queueError.message : String(queueError) }),
      }));
    },
  });
  return { id, filename: file.name, contentType, size: file.size };
}

export async function readAttachment(id: string) {
  await ensureSchema();
  const metadata = await env.DB.prepare(`SELECT object_key AS objectKey, filename, content_type AS contentType
    FROM attachments WHERE id = ?`).bind(id).first<{ objectKey: string; filename: string; contentType: string }>();
  if (!metadata) return null;
  const object = await env.FILES.get(metadata.objectKey);
  return object ? { metadata, object } : null;
}

export async function listAttachments(): Promise<Attachment[]> {
  await ensureSchema();
  const result = await env.DB.prepare("SELECT id, filename, content_type AS contentType, size FROM attachments ORDER BY created_at DESC").all<Attachment>();
  return result.results;
}

async function finalizeAttachmentObjectDeletion(objectKey: string): Promise<void> {
  // The queue reserves a key against reuse until R2 confirms deletion. A
  // surviving legacy metadata row means this was not the last reference and
  // the physical object must remain.
  const stale = await env.DB.prepare(`DELETE FROM object_deletion_queue
    WHERE object_key = ? AND EXISTS (SELECT 1 FROM attachments WHERE object_key = ?)`)
    .bind(objectKey, objectKey).run();
  if (stale.meta.changes) return;
  const queued = await env.DB.prepare("SELECT object_key FROM object_deletion_queue WHERE object_key = ?").bind(objectKey).first<{ object_key: string }>();
  if (!queued) return;
  await finalizeQueuedObjectDeletion(objectKey, {
    deleteObject: (key) => env.FILES.delete(key),
    clearQueuedObject: async (key) => {
      await env.DB.prepare("DELETE FROM object_deletion_queue WHERE object_key = ?").bind(key).run();
    },
  });
}

async function compensateFailedPersonPhotoLink(attachmentId: string): Promise<void> {
  const metadata = await env.DB.prepare("SELECT object_key AS objectKey FROM attachments WHERE id = ?")
    .bind(attachmentId).first<{ objectKey: string }>();
  if (!metadata) return;
  const [deleted] = await env.DB.batch(prepareUnreferencedAttachmentCompensation(env.DB, {
    attachmentId,
    objectKey: metadata.objectKey,
    deletedAt: new Date().toISOString(),
  }));
  if (!deleted.meta.changes) {
    console.error(JSON.stringify({
      message: "failed person-photo link may have committed; preserving referenced attachment",
      attachmentId,
      objectKey: metadata.objectKey,
    }));
    return;
  }
  try {
    await finalizeAttachmentObjectDeletion(metadata.objectKey);
  } catch (error) {
    // Metadata is gone but the durable queue row remains for a later retry.
    console.error(JSON.stringify({
      message: "failed person-photo link cleanup remains queued",
      attachmentId,
      objectKey: metadata.objectKey,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function retryPendingObjectDeletions(): Promise<void> {
  try {
    // Clear only queue rows that still have legacy live metadata. This single
    // conditional write cannot lose a concurrent last-metadata deletion: that
    // transaction will recreate the intent after our write commits.
    await env.DB.prepare(`DELETE FROM object_deletion_queue
      WHERE EXISTS (SELECT 1 FROM attachments WHERE attachments.object_key = object_deletion_queue.object_key)`).run();
    const pending = await env.DB.prepare(`SELECT object_key AS objectKey FROM object_deletion_queue
      WHERE NOT EXISTS (SELECT 1 FROM attachments WHERE attachments.object_key = object_deletion_queue.object_key)
      ORDER BY queued_at, object_key LIMIT ?`)
      .bind(OBJECT_DELETION_RETRY_BATCH_SIZE).all<{ objectKey: string }>();
    const attemptedAt = new Date(Date.now() + 1).toISOString();
    await retryQueuedObjectDeletionBatch(pending.results.map(({ objectKey }) => objectKey), {
      markAttempts: async (objectKeys) => {
        await env.DB.batch(objectKeys.map((objectKey) => env.DB.prepare(
          "UPDATE object_deletion_queue SET queued_at = ? WHERE object_key = ?",
        ).bind(attemptedAt, objectKey)));
      },
      deleteObjects: (objectKeys) => env.FILES.delete([...objectKeys]),
      clearQueuedObjects: async (objectKeys) => {
        await env.DB.batch(objectKeys.map((objectKey) => env.DB.prepare(`DELETE FROM object_deletion_queue
          WHERE object_key = ? AND NOT EXISTS (SELECT 1 FROM attachments WHERE object_key = ?)`)
          .bind(objectKey, objectKey)));
      },
      reportFailure: (objectKeys, error) => {
        console.error(JSON.stringify({
          message: "attachment object deletion batch remains queued",
          objectKeys,
          error: error instanceof Error ? error.message : String(error),
        }));
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "attachment object deletion retry scan failed",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function deferPendingObjectDeletions(): Promise<void> {
  await deferObjectDeletionRetries(retryPendingObjectDeletions(), waitUntil, (error) => {
    console.error(JSON.stringify({
      message: "attachment object deletion retry could not be deferred; awaiting it before return",
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

function nullable(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function requirePersonTarget(personId: string): Promise<void> {
  const person = await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(personId).first<{ id: string }>();
  if (!person) throw new Error("That person is no longer in the tree.");
}

type PhotoTargetState = { personExists: number; attachmentExists: number; linkExists: number; portraitMatches: number };
async function photoTargetState(personId: string, attachmentId: string): Promise<PhotoTargetState> {
  return (await env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM people WHERE id = ?) AS personExists,
    EXISTS(SELECT 1 FROM attachments WHERE id = ?) AS attachmentExists,
    EXISTS(SELECT 1 FROM person_photos WHERE person_id = ? AND attachment_id = ?) AS linkExists,
    EXISTS(SELECT 1 FROM people WHERE id = ? AND photo_attachment_id = ?) AS portraitMatches`)
    .bind(personId, attachmentId, personId, attachmentId, personId, attachmentId).first<PhotoTargetState>())
    ?? { personExists: 0, attachmentExists: 0, linkExists: 0, portraitMatches: 0 };
}

function requirePhotoTargets(target: PhotoTargetState): void {
  if (!target.personExists) throw new Error("That person is no longer in the tree.");
  if (!target.attachmentExists) throw new Error("That photograph no longer exists.");
}

function personValues(input: Record<string, unknown>): Omit<Person, "id"> {
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (!displayName) throw new Error("A person needs a display name.");
  return {
    displayName, gender: input.gender === "male" || input.gender === "female" ? input.gender : null, givenName: nullable(input.givenName), familyName: nullable(input.familyName), maidenName: nullable(input.maidenName),
    birthDate: nullable(input.birthDate), deathDate: nullable(input.deathDate),
    birthPlace: nullable(input.birthPlace), deathPlace: nullable(input.deathPlace), birthCity: nullable(input.birthCity), birthCountry: nullable(input.birthCountry), deathCity: nullable(input.deathCity), deathCountry: nullable(input.deathCountry), burialPlace: nullable(input.burialPlace), residence: nullable(input.residence), biography: nullable(input.biography), photoAttachmentId: nullable(input.photoAttachmentId),
  };
}

export type ClaimSource = {
  sourceType: EvidenceClaim["sourceType"];
  sourceLabel: string;
  attachmentId?: string | null;
  sourceLocator?: string | null;
  sourceExcerpt?: string | null;
  confidence?: number;
};

const defaultClaimSource = (actorEmail: string): ClaimSource => ({
  sourceType: "manual",
  sourceLabel: `Edited by ${actorEmail}`,
  confidence: 100,
});

const personClaimEntries = (person: Omit<Person, "id">) => Object.entries(person)
  .filter(([key, value]) => key !== "photoIds" && value !== undefined)
  .map(([predicate, value]) => [predicate, value === null ? null : String(value)] as const);

function claimStatements(
  subjectType: EvidenceClaim["subjectType"],
  subjectId: string,
  entries: readonly (readonly [string, string | null])[],
  actorEmail: string,
  now: string,
  source: ClaimSource,
): D1PreparedStatement[] {
  const confidence = Math.max(0, Math.min(100, Math.round(source.confidence ?? 100)));
  return entries.flatMap(([predicate, value]) => [
    env.DB.prepare(`UPDATE evidence_claims SET status = 'disputed', updated_at = ?
      WHERE subject_type = ? AND subject_id = ? AND predicate = ? AND status = 'preferred' AND value IS NOT ?`)
      .bind(now, subjectType, subjectId, predicate, value),
    env.DB.prepare(`INSERT INTO evidence_claims
      (id, subject_type, subject_id, predicate, value, status, confidence, source_type, attachment_id,
       source_label, source_locator, source_excerpt, created_by, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 'preferred', ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM evidence_claims
        WHERE subject_type = ? AND subject_id = ? AND predicate = ? AND status = 'preferred' AND value IS ?)`)
      .bind(crypto.randomUUID(), subjectType, subjectId, predicate, value, confidence, source.sourceType,
        source.attachmentId ?? null, source.sourceLabel, source.sourceLocator ?? null, source.sourceExcerpt ?? null,
        actorEmail, now, now, subjectType, subjectId, predicate, value),
  ]);
}

export async function listEvidenceClaims(subjectType: EvidenceClaim["subjectType"], subjectId: string): Promise<EvidenceClaim[]> {
  await ensureSchema();
  const result = await env.DB.prepare(`SELECT id, subject_type AS subjectType, subject_id AS subjectId, predicate, value,
    status, confidence, source_type AS sourceType, attachment_id AS attachmentId, source_label AS sourceLabel,
    source_locator AS sourceLocator, source_excerpt AS sourceExcerpt, created_by AS createdBy,
    created_at AS createdAt, updated_at AS updatedAt FROM evidence_claims
    WHERE subject_type = ? AND subject_id = ?
    ORDER BY CASE status WHEN 'preferred' THEN 0 WHEN 'disputed' THEN 1 ELSE 2 END, predicate, created_at DESC`)
    .bind(subjectType, subjectId).all<EvidenceClaim>();
  return result.results;
}

type MergeSnapshot = {
  sourcePersonId: string;
  targetPersonId: string;
  people: Record<string, unknown>[];
  relationships: Record<string, unknown>[];
  storyPeople: Record<string, unknown>[];
  personPhotos: Record<string, unknown>[];
  comments: Record<string, unknown>[];
  members: Record<string, unknown>[];
  claims: Record<string, unknown>[];
  questions: Record<string, unknown>[];
};

async function mergeSnapshot(sourcePersonId: string, targetPersonId: string): Promise<MergeSnapshot> {
  const ids = [sourcePersonId, targetPersonId] as const;
  const people = await env.DB.prepare("SELECT * FROM people WHERE id IN (?, ?)").bind(...ids).all<Record<string, unknown>>();
  const relationships = await env.DB.prepare("SELECT * FROM relationships WHERE from_person_id IN (?, ?) OR to_person_id IN (?, ?)")
    .bind(...ids, ...ids).all<Record<string, unknown>>();
  const storyPeople = await env.DB.prepare("SELECT * FROM story_people WHERE person_id IN (?, ?)").bind(...ids).all<Record<string, unknown>>();
  const personPhotos = await env.DB.prepare("SELECT * FROM person_photos WHERE person_id IN (?, ?)").bind(...ids).all<Record<string, unknown>>();
  const comments = await env.DB.prepare("SELECT * FROM person_comments WHERE person_id IN (?, ?)").bind(...ids).all<Record<string, unknown>>();
  const members = await env.DB.prepare("SELECT * FROM members WHERE person_id IN (?, ?)").bind(...ids).all<Record<string, unknown>>();
  const claims = await env.DB.prepare(`SELECT * FROM evidence_claims WHERE
    (subject_type = 'person' AND subject_id IN (?, ?)) OR
    (subject_type = 'relationship' AND subject_id IN (SELECT id FROM relationships WHERE from_person_id IN (?, ?) OR to_person_id IN (?, ?)))`)
    .bind(...ids, ...ids, ...ids).all<Record<string, unknown>>();
  const questions = await env.DB.prepare("SELECT * FROM open_questions WHERE proposal_json IS NOT NULL AND instr(proposal_json, ?) > 0")
    .bind(JSON.stringify(sourcePersonId)).all<Record<string, unknown>>();
  return {
    sourcePersonId, targetPersonId, people: people.results, relationships: relationships.results,
    storyPeople: storyPeople.results, personPhotos: personPhotos.results, comments: comments.results,
    members: members.results, claims: claims.results, questions: questions.results,
  };
}

function mergedPerson(source: Person, target: Person): Omit<Person, "id"> {
  const choose = <K extends keyof Omit<Person, "id">>(key: K) => target[key] ?? source[key];
  const sourceBio = source.biography?.trim() ?? "";
  const targetBio = target.biography?.trim() ?? "";
  const biography = !sourceBio || targetBio.includes(sourceBio) ? target.biography
    : !targetBio || sourceBio.includes(targetBio) ? source.biography
      : `${targetBio}${targetBio.endsWith(".") ? "" : "."} ${sourceBio}`;
  return {
    displayName: target.displayName || source.displayName, gender: choose("gender"), givenName: choose("givenName"),
    familyName: choose("familyName"), maidenName: choose("maidenName"), birthDate: choose("birthDate"),
    deathDate: choose("deathDate"), birthPlace: choose("birthPlace"), deathPlace: choose("deathPlace"),
    birthCity: choose("birthCity"), birthCountry: choose("birthCountry"), deathCity: choose("deathCity"),
    deathCountry: choose("deathCountry"), burialPlace: choose("burialPlace"), residence: choose("residence"),
    biography, photoAttachmentId: choose("photoAttachmentId"), photoIds: target.photoIds ?? source.photoIds,
  };
}

const relationshipSignature = (relationship: Pick<Relationship, "fromPersonId" | "toPersonId" | "type">) => relationship.type === "spouse"
  ? `spouse:${[relationship.fromPersonId, relationship.toPersonId].sort().join(":")}`
  : `parent:${relationship.fromPersonId}:${relationship.toPersonId}`;

async function mergePeople(sourcePersonId: string, targetPersonId: string, summary: string, actorEmail: string, source: ClaimSource): Promise<FamilyTree> {
  await ensureSchema();
  if (!sourcePersonId || !targetPersonId || sourcePersonId === targetPersonId) throw new Error("A merge needs two different people.");
  const tree = await readTree();
  const sourcePerson = tree.people.find((person) => person.id === sourcePersonId);
  const targetPerson = tree.people.find((person) => person.id === targetPersonId);
  if (!sourcePerson || !targetPerson) throw new Error("One of those people is no longer in the tree.");
  const snapshot = await mergeSnapshot(sourcePersonId, targetPersonId);
  const merged = mergedPerson(sourcePerson, targetPerson);
  const now = new Date().toISOString();
  const changeId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`UPDATE people SET display_name = ?, gender = ?, given_name = ?, family_name = ?, maiden_name = ?, birth_date = ?,
      death_date = ?, birth_place = ?, death_place = ?, birth_city = ?, birth_country = ?, death_city = ?, death_country = ?, burial_place = ?,
      residence = ?, biography = ?, photo_attachment_id = ?, updated_at = ? WHERE id = ?`)
      .bind(merged.displayName, merged.gender, merged.givenName, merged.familyName, merged.maidenName, merged.birthDate,
        merged.deathDate, merged.birthPlace, merged.deathPlace, merged.birthCity, merged.birthCountry, merged.deathCity,
        merged.deathCountry, merged.burialPlace, merged.residence, merged.biography, merged.photoAttachmentId, now, targetPersonId),
    ...claimStatements("person", targetPersonId, personClaimEntries(merged)
      .filter(([predicate, value]) => String(targetPerson[predicate as keyof Person] ?? "") !== String(value ?? "")), actorEmail, now, source),
  ];

  const occupied = new Set(tree.relationships.filter((relationship) => relationship.fromPersonId !== sourcePersonId && relationship.toPersonId !== sourcePersonId).map(relationshipSignature));
  for (const relationship of tree.relationships.filter((candidate) => candidate.fromPersonId === sourcePersonId || candidate.toPersonId === sourcePersonId)) {
    const next = {
      ...relationship,
      fromPersonId: relationship.fromPersonId === sourcePersonId ? targetPersonId : relationship.fromPersonId,
      toPersonId: relationship.toPersonId === sourcePersonId ? targetPersonId : relationship.toPersonId,
    };
    const signature = relationshipSignature(next);
    if (next.fromPersonId === next.toPersonId || occupied.has(signature)) {
      statements.push(
        env.DB.prepare("DELETE FROM evidence_claims WHERE subject_type = 'relationship' AND subject_id = ?").bind(relationship.id),
        env.DB.prepare("DELETE FROM relationships WHERE id = ?").bind(relationship.id),
      );
      continue;
    }
    occupied.add(signature);
    statements.push(
      env.DB.prepare("UPDATE relationships SET from_person_id = ?, to_person_id = ? WHERE id = ?").bind(next.fromPersonId, next.toPersonId, relationship.id),
      env.DB.prepare("UPDATE evidence_claims SET value = ?, updated_at = ? WHERE subject_type = 'relationship' AND subject_id = ? AND predicate = 'fromPersonId'").bind(next.fromPersonId, now, relationship.id),
      env.DB.prepare("UPDATE evidence_claims SET value = ?, updated_at = ? WHERE subject_type = 'relationship' AND subject_id = ? AND predicate = 'toPersonId'").bind(next.toPersonId, now, relationship.id),
    );
  }

  statements.push(
    env.DB.prepare("INSERT OR IGNORE INTO story_people (story_id, person_id) SELECT story_id, ? FROM story_people WHERE person_id = ?").bind(targetPersonId, sourcePersonId),
    env.DB.prepare("DELETE FROM story_people WHERE person_id = ?").bind(sourcePersonId),
    env.DB.prepare("INSERT OR IGNORE INTO person_photos (person_id, attachment_id, created_at) SELECT ?, attachment_id, created_at FROM person_photos WHERE person_id = ?").bind(targetPersonId, sourcePersonId),
    env.DB.prepare("DELETE FROM person_photos WHERE person_id = ?").bind(sourcePersonId),
    env.DB.prepare("UPDATE person_comments SET person_id = ? WHERE person_id = ?").bind(targetPersonId, sourcePersonId),
    env.DB.prepare("UPDATE members SET person_id = NULL, updated_at = ? WHERE person_id = ? AND EXISTS (SELECT 1 FROM members WHERE person_id = ?)").bind(now, sourcePersonId, targetPersonId),
    env.DB.prepare("UPDATE members SET person_id = ?, updated_at = ? WHERE person_id = ?").bind(targetPersonId, now, sourcePersonId),
    env.DB.prepare(`UPDATE evidence_claims SET status = 'disputed', updated_at = ? WHERE subject_type = 'person' AND subject_id = ? AND status = 'preferred'
      AND EXISTS (SELECT 1 FROM evidence_claims target WHERE target.subject_type = 'person' AND target.subject_id = ?
        AND target.predicate = evidence_claims.predicate AND target.status = 'preferred' AND target.value IS NOT evidence_claims.value)`).bind(now, sourcePersonId, targetPersonId),
    env.DB.prepare("UPDATE evidence_claims SET subject_id = ?, updated_at = ? WHERE subject_type = 'person' AND subject_id = ?").bind(targetPersonId, now, sourcePersonId),
    env.DB.prepare("UPDATE open_questions SET proposal_json = replace(proposal_json, ?, ?) WHERE proposal_json IS NOT NULL AND instr(proposal_json, ?) > 0")
      .bind(sourcePersonId, targetPersonId, JSON.stringify(sourcePersonId)),
    env.DB.prepare("DELETE FROM people WHERE id = ?").bind(sourcePersonId),
    env.DB.prepare("INSERT INTO merge_snapshots (change_id, source_person_id, target_person_id, snapshot_json, merged_at) VALUES (?, ?, ?, ?, ?)")
      .bind(changeId, sourcePersonId, targetPersonId, JSON.stringify(snapshot), now),
    env.DB.prepare("INSERT INTO undo_entries (change_id, inverse_json, status) VALUES (?, ?, 'active')")
      .bind(changeId, JSON.stringify({ kind: "undo_merge", changeId })),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, 'merge_people', ?, ?, ?)")
      .bind(changeId, actorEmail, summary, JSON.stringify({ sourcePersonId, targetPersonId }), now),
  );
  await env.DB.batch(statements);
  treeJsonCache = null;
  return readTree();
}

export async function setEvidenceClaimStatus(
  claimId: string,
  status: "preferred" | "rejected",
  actorEmail: string,
): Promise<EvidenceClaim[]> {
  await ensureSchema();
  const claim = await env.DB.prepare(`SELECT id, subject_type AS subjectType, subject_id AS subjectId, predicate, value
    FROM evidence_claims WHERE id = ?`).bind(claimId).first<Pick<EvidenceClaim, "id" | "subjectType" | "subjectId" | "predicate" | "value">>();
  if (!claim) throw new Error("That evidence claim no longer exists.");
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (status === "preferred") {
    statements.push(env.DB.prepare(`UPDATE evidence_claims SET status = 'disputed', updated_at = ?
      WHERE subject_type = ? AND subject_id = ? AND predicate = ? AND status = 'preferred' AND id != ?`)
      .bind(now, claim.subjectType, claim.subjectId, claim.predicate, claim.id));
    const personColumns: Record<string, string> = {
      displayName: "display_name", gender: "gender", givenName: "given_name", familyName: "family_name",
      maidenName: "maiden_name", birthDate: "birth_date", deathDate: "death_date", birthPlace: "birth_place",
      deathPlace: "death_place", birthCity: "birth_city", birthCountry: "birth_country", deathCity: "death_city",
      deathCountry: "death_country", burialPlace: "burial_place", residence: "residence", biography: "biography",
      photoAttachmentId: "photo_attachment_id",
    };
    const column = claim.subjectType === "person" ? personColumns[claim.predicate] : null;
    if (column) statements.push(env.DB.prepare(`UPDATE people SET ${column} = ?, updated_at = ? WHERE id = ?`).bind(claim.value, now, claim.subjectId));
  }
  statements.push(
    env.DB.prepare("UPDATE evidence_claims SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, claim.id),
    env.DB.prepare(`INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at)
      VALUES (?, ?, 'adjudicate_claim', ?, ?, ?)`)
      .bind(crypto.randomUUID(), actorEmail,
        status === "preferred" ? `Preferred evidence for ${claim.predicate}` : `Rejected evidence for ${claim.predicate}`,
        JSON.stringify({ claimId: claim.id, subjectType: claim.subjectType, subjectId: claim.subjectId, predicate: claim.predicate, status }), now),
  );
  await env.DB.batch(statements);
  treeJsonCache = null;
  return listEvidenceClaims(claim.subjectType, claim.subjectId);
}

async function readMutationInvariants(includeAttachments = false) {
  // readTree already fans out to D1's six per-invocation connections, so the
  // optional seventh query runs afterward rather than competing with it.
  const tree = await readTree();
  const attachmentRows = includeAttachments
    ? await env.DB.prepare("SELECT id FROM attachments").all<{ id: string }>()
    : { results: [] as { id: string }[] };
  return new MutationInvariants(tree, attachmentRows.results.map(({ id }) => id));
}

export async function applyProposal(proposal: ChangeProposal, actorEmail: string, claimSource: ClaimSource = defaultClaimSource(actorEmail)): Promise<FamilyTree> {
  if (!isChangeProposal(proposal)) throw new Error("Invalid change proposal.");
  if (proposal.kind === "merge_people") return mergePeople(proposal.sourcePersonId, proposal.targetPersonId, proposal.summary, actorEmail, claimSource);
  await ensureSchema();
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  let inverse: ChangeProposal | null = null;
  let deletedObjectKey: string | null = null;
  if (proposal.kind === "add_person") {
    const person = personValues(proposal.person as unknown as Record<string, unknown>);
    const personId = crypto.randomUUID();
    inverse = { kind: "delete_person", summary: `Undid: ${proposal.summary}`, personId };
    statements.push(env.DB.prepare(`INSERT INTO people
      (id, display_name, gender, given_name, family_name, maiden_name, birth_date, death_date, birth_place, death_place, birth_city, birth_country, death_city, death_country, burial_place, residence, biography, photo_attachment_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(personId, person.displayName, person.gender, person.givenName, person.familyName, person.maidenName, person.birthDate,
        person.deathDate, person.birthPlace, person.deathPlace, person.birthCity, person.birthCountry, person.deathCity, person.deathCountry, person.burialPlace, person.residence, person.biography, person.photoAttachmentId, now, now));
    statements.push(...claimStatements("person", personId, personClaimEntries(person).filter(([, value]) => value !== null), actorEmail, now, claimSource));
    if (proposal.relationshipHints?.length) {
      const invariants = await readMutationInvariants();
      invariants.addPerson(personId);
      for (const hint of proposal.relationshipHints) {
        const relatedPersonId = invariants.personIdByUniqueName(hint.personName);
        if (!relatedPersonId) continue;
        const from = hint.relationshipType === "parent" ? relatedPersonId : personId;
        const to = hint.relationshipType === "parent" ? personId : relatedPersonId;
        invariants.addRelationship(from, to, hint.relationshipType);
        const relationshipId = crypto.randomUUID();
        statements.push(env.DB.prepare("INSERT INTO relationships (id, from_person_id, to_person_id, type, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(relationshipId, from, to, hint.relationshipType, now));
        statements.push(...claimStatements("relationship", relationshipId, [
          ["fromPersonId", from], ["toPersonId", to], ["type", hint.relationshipType],
        ], actorEmail, now, claimSource));
      }
    }
  } else if (proposal.kind === "update_person") {
    const person = personValues(proposal.patch as unknown as Record<string, unknown>);
    const before = (await readTree()).people.find((candidate) => candidate.id === proposal.personId);
    if (!before) throw new Error("That person is no longer in the tree.");
    inverse = { kind: "update_person", summary: `Undid: ${proposal.summary}`, personId: proposal.personId, patch: before };
    statements.push(env.DB.prepare(`UPDATE people SET display_name = ?, gender = ?, given_name = ?, family_name = ?, maiden_name = ?, birth_date = ?,
      death_date = ?, birth_place = ?, death_place = ?, birth_city = ?, birth_country = ?, death_city = ?, death_country = ?, burial_place = ?, residence = ?, biography = ?, photo_attachment_id = ?, updated_at = ? WHERE id = ?`)
      .bind(person.displayName, person.gender, person.givenName, person.familyName, person.maidenName, person.birthDate, person.deathDate,
        person.birthPlace, person.deathPlace, person.birthCity, person.birthCountry, person.deathCity, person.deathCountry, person.burialPlace, person.residence, person.biography, person.photoAttachmentId, now, proposal.personId));
    const changedClaims = personClaimEntries(person).filter(([predicate, value]) => String(before[predicate as keyof Person] ?? "") !== String(value ?? ""));
    statements.push(...claimStatements("person", proposal.personId, changedClaims, actorEmail, now, claimSource));
  } else if (proposal.kind === "delete_person") {
    (await readMutationInvariants()).person(proposal.personId);
    const snapshot = await mergeSnapshot(proposal.personId, proposal.personId);
    inverse = null;
    statements.push(
      env.DB.prepare("INSERT INTO person_deletion_snapshots (change_id, person_id, snapshot_json, deleted_at) VALUES (?, ?, ?, ?)")
        .bind(auditId, proposal.personId, JSON.stringify(snapshot), now),
      env.DB.prepare("INSERT INTO undo_entries (change_id, inverse_json, status) VALUES (?, ?, 'active')")
        .bind(auditId, JSON.stringify({ kind: "undo_delete_person", changeId: auditId })),
    );
    statements.push(...preparePersonDeletion(env.DB, { personId: proposal.personId, actorEmail, deletedAt: now }));
  } else if (proposal.kind === "add_relationship") {
    const resolvePersonId = async (id: string, name?: string | null) => {
      if (id) {
        const record = await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(id).first<{ id: string }>();
        if (!record) throw new Error("A referenced person no longer exists.");
        return record.id;
      }
      if (!name?.trim()) throw new Error("A relationship needs two people.");
      const matches = await env.DB.prepare("SELECT id FROM people WHERE lower(display_name) = lower(?)").bind(name.trim()).all<{ id: string }>();
      if (matches.results.length !== 1) throw new Error(matches.results.length ? `More than one person is named ${name}.` : `${name} is not in the tree yet.`);
      return matches.results[0].id;
    };
    const fromPersonId = await resolvePersonId(proposal.fromPersonId, proposal.fromPersonName);
    const toPersonId = await resolvePersonId(proposal.toPersonId, proposal.toPersonName);
    if (!(["parent", "spouse"] as const).includes(proposal.relationshipType)) throw new Error("Unsupported relationship.");
    new MutationInvariants(await readTree()).addRelationship(fromPersonId, toPersonId, proposal.relationshipType);
    const relationshipId = crypto.randomUUID();
    inverse = { kind: "delete_relationship", summary: `Undid: ${proposal.summary}`, relationshipId };
    statements.push(env.DB.prepare(`INSERT INTO relationships
      (id, from_person_id, to_person_id, type, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(relationshipId, fromPersonId, toPersonId, proposal.relationshipType, now));
    statements.push(...claimStatements("relationship", relationshipId, [
      ["fromPersonId", fromPersonId], ["toPersonId", toPersonId], ["type", proposal.relationshipType],
    ], actorEmail, now, claimSource));
  } else if (proposal.kind === "delete_relationship") {
    const relationship = new MutationInvariants(await readTree()).relationship(proposal.relationshipId);
    inverse = { kind: "add_relationship", summary: `Undid: ${proposal.summary}`, fromPersonId: relationship.fromPersonId, toPersonId: relationship.toPersonId, relationshipType: relationship.type };
    statements.push(
      env.DB.prepare("DELETE FROM evidence_claims WHERE subject_type = 'relationship' AND subject_id = ?").bind(proposal.relationshipId),
      env.DB.prepare("DELETE FROM relationships WHERE id = ?").bind(proposal.relationshipId),
    );
  } else if (proposal.kind === "add_story") {
    if (!proposal.title.trim() || !proposal.body.trim()) throw new Error("A story needs a title and text.");
    const invariants = await readMutationInvariants(true);
    invariants.storyPeople(proposal.personIds);
    invariants.storyAttachments(proposal.attachmentIds);
    const storyId = crypto.randomUUID();
    inverse = { kind: "delete_story", summary: `Undid: ${proposal.summary}`, storyId };
    statements.push(env.DB.prepare(`INSERT INTO stories (id, title, body, date, place, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(storyId, proposal.title.trim(), proposal.body.trim(), nullable(proposal.date), nullable(proposal.place), now));
    for (const personId of proposal.personIds) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO story_people (story_id, person_id) VALUES (?, ?)`).bind(storyId, personId));
    for (const attachmentId of proposal.attachmentIds) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO story_attachments (story_id, attachment_id) VALUES (?, ?)`).bind(storyId, attachmentId));
  } else if (proposal.kind === "update_story") {
    if (!proposal.title.trim() || !proposal.body.trim()) throw new Error("A story needs a title and text.");
    const invariants = await readMutationInvariants(true);
    invariants.story(proposal.storyId);
    invariants.storyPeople(proposal.personIds);
    invariants.storyAttachments(proposal.attachmentIds);
    const previous = (await readTree()).stories.find((story) => story.id === proposal.storyId);
    if (previous) inverse = { kind: "update_story", summary: `Undid: ${proposal.summary}`, storyId: previous.id, title: previous.title, body: previous.body, date: previous.date, place: previous.place, personIds: previous.personIds, attachmentIds: previous.attachmentIds ?? [] };
    statements.push(
      env.DB.prepare("UPDATE stories SET title = ?, body = ?, date = ?, place = ? WHERE id = ?").bind(proposal.title.trim(), proposal.body.trim(), nullable(proposal.date), nullable(proposal.place), proposal.storyId),
      env.DB.prepare("DELETE FROM story_people WHERE story_id = ?").bind(proposal.storyId),
      env.DB.prepare("DELETE FROM story_attachments WHERE story_id = ?").bind(proposal.storyId),
    );
    for (const personId of proposal.personIds) statements.push(env.DB.prepare("INSERT OR IGNORE INTO story_people (story_id, person_id) VALUES (?, ?)").bind(proposal.storyId, personId));
    for (const attachmentId of proposal.attachmentIds) statements.push(env.DB.prepare("INSERT OR IGNORE INTO story_attachments (story_id, attachment_id) VALUES (?, ?)").bind(proposal.storyId, attachmentId));
  } else if (proposal.kind === "delete_story") {
    const currentTree = await readTree();
    new MutationInvariants(currentTree).story(proposal.storyId);
    const previous = currentTree.stories.find((story) => story.id === proposal.storyId);
    if (previous) inverse = { kind: "add_story", summary: `Undid: ${proposal.summary}`, title: previous.title, body: previous.body, date: previous.date, place: previous.place, personIds: previous.personIds, attachmentIds: previous.attachmentIds ?? [] };
    statements.push(
      env.DB.prepare("DELETE FROM story_people WHERE story_id = ?").bind(proposal.storyId),
      env.DB.prepare("DELETE FROM story_attachments WHERE story_id = ?").bind(proposal.storyId),
      env.DB.prepare("DELETE FROM stories WHERE id = ?").bind(proposal.storyId),
    );
  } else if (proposal.kind === "delete_attachment") {
    const attachment = await env.DB.prepare("SELECT object_key AS objectKey FROM attachments WHERE id = ?").bind(proposal.attachmentId).first<{ objectKey: string }>();
    if (!attachment) throw new Error("That attachment no longer exists.");
    deletedObjectKey = attachment.objectKey;
    statements.push(...prepareAttachmentDeletion(env.DB, {
      attachmentId: proposal.attachmentId,
      objectKey: attachment.objectKey,
      deletedAt: now,
    }));
  }
  statements.push(env.DB.prepare(`INSERT INTO change_log
    (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(auditId, actorEmail, proposal.kind, proposal.summary, JSON.stringify(proposal), now));
  if (inverse) statements.push(env.DB.prepare("INSERT INTO undo_entries (change_id, inverse_json, status) VALUES (?, ?, 'active')")
    .bind(auditId, JSON.stringify(inverse)));
  await env.DB.batch(statements);
  treeJsonCache = null;
  if (deletedObjectKey) {
    try {
      await finalizeAttachmentObjectDeletion(deletedObjectKey);
    } catch (error) {
      // D1 no longer exposes the attachment and retains the object key for a
      // later retry. The logical delete is complete even if physical cleanup
      // is temporarily unavailable.
      console.error(JSON.stringify({
        message: "attachment object deletion queued after immediate cleanup failed",
        objectKey: deletedObjectKey,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  const tree = await readTree();
  await deferPendingObjectDeletions();
  return tree;
}

export async function updatePerson(personId: string, patch: Record<string, unknown>, actorEmail: string) {
  const current = (await readTree()).people.find((person) => person.id === personId);
  if (!current) throw new Error("That person is no longer in the tree.");
  const merged = Object.fromEntries(Object.keys(current).filter((key) => key !== "id").map((key) => [key, Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : current[key as keyof Person]]));
  return applyProposal({ kind: "update_person", summary: "Updated person details", personId, patch: personValues(merged) }, actorEmail);
}

export async function addRelationship(fromPersonId: string, toPersonId: string, relationshipType: "parent" | "spouse", actorEmail: string) {
  return applyProposal({ kind: "add_relationship", summary: "Added a family relationship", fromPersonId, toPersonId, relationshipType }, actorEmail);
}

export async function setRelationshipStatus(relationshipId: string, status: string | null, actorEmail: string) {
  await ensureSchema();
  new MutationInvariants(await readTree()).relationship(relationshipId, "spouse");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE relationships SET status = ? WHERE id = ? AND type = 'spouse'").bind(status, relationshipId),
    ...claimStatements("relationship", relationshipId, [["status", status]], actorEmail, now, defaultClaimSource(actorEmail)),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "set_relationship_status", status ? `Marked a marriage as ${status}` : "Cleared a marriage status", JSON.stringify({ relationshipId, status }), now),
  ]);
  return readTree();
}

export async function removeRelationship(relationshipId: string, actorEmail: string) {
  new MutationInvariants(await readTree()).relationship(relationshipId);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM evidence_claims WHERE subject_type = 'relationship' AND subject_id = ?").bind(relationshipId),
    env.DB.prepare("DELETE FROM relationships WHERE id = ?").bind(relationshipId),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), actorEmail, "remove_relationship", "Removed a family relationship", JSON.stringify({ relationshipId }), now),
  ]);
  return readTree();
}

export async function attachPersonPhoto(personId: string, file: File, actorEmail: string) {
  await ensureSchema();
  // Validate before the R2 write. The insert trigger remains the concurrent
  // backstop if the person is removed between this read and the D1 batch.
  await requirePersonTarget(personId);
  const current = await env.DB.prepare("SELECT photo_attachment_id AS photoAttachmentId FROM people WHERE id = ?")
    .bind(personId).first<{ photoAttachmentId: string | null }>();
  const attachment = await saveAttachment(file, actorEmail);
  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO person_photos (person_id, attachment_id, created_at) VALUES (?, ?, ?)").bind(personId, attachment.id, now),
      // the first photograph of someone becomes their portrait; later ones join the gallery
      env.DB.prepare("UPDATE people SET photo_attachment_id = COALESCE(photo_attachment_id, ?), updated_at = ? WHERE id = ?").bind(attachment.id, now, personId),
      ...(current?.photoAttachmentId ? [] : claimStatements("person", personId, [["photoAttachmentId", attachment.id]], actorEmail, now, {
        sourceType: "attachment", sourceLabel: file.name, attachmentId: attachment.id, confidence: 100,
      })),
      env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), actorEmail, "attach_person_photo", "Added a family photograph", JSON.stringify({ personId, attachmentId: attachment.id }), now),
    ]);
  } catch (linkError) {
    try {
      await compensateFailedPersonPhotoLink(attachment.id);
    } catch (compensationError) {
      // Preserve the original link error while surfacing any possible private
      // orphan for operators to reconcile.
      console.error(JSON.stringify({
        message: "failed person-photo link could not be safely compensated",
        attachmentId: attachment.id,
        error: compensationError instanceof Error ? compensationError.message : String(compensationError),
      }));
    }
    throw linkError;
  }
  return readTree();
}

export async function removePersonPhoto(personId: string, actorEmail: string) {
  await ensureSchema();
  await requirePersonTarget(personId);
  const current = await env.DB.prepare("SELECT photo_attachment_id AS photoAttachmentId FROM people WHERE id = ?")
    .bind(personId).first<{ photoAttachmentId: string | null }>();
  if (!current?.photoAttachmentId) return readTree();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE people SET photo_attachment_id = NULL, updated_at = ? WHERE id = ? AND photo_attachment_id IS NOT NULL").bind(now, personId),
    env.DB.prepare(`INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), actorEmail, "remove_person_photo", "Removed a family portrait", JSON.stringify({ personId }), now),
    ...claimStatements("person", personId, [["photoAttachmentId", null]], actorEmail, now, defaultClaimSource(actorEmail)),
  ]);
  return readTree();
}

export async function removePerson(personId: string, actorEmail: string) {
  await ensureSchema();
  (await readMutationInvariants()).person(personId);
  const now = new Date().toISOString();
  await env.DB.batch([
    ...preparePersonDeletion(env.DB, { personId, actorEmail, deletedAt: now }),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), actorEmail, "remove_person", "Removed a family member", JSON.stringify({ personId }), now),
  ]);
  return readTree();
}


// ---------- open questions: the Fill-in tab's review queue ----------
// A question records something the archive implies but never states. The
// proposal_json holds the prepared change, with person ids resolved when the
// question was seeded; confirming applies it, denying just closes it. Either
// way the verdict is permanent in the row and in the change log.
type QuestionAction =
  | { type: "add_parent"; parentId: string; childId: string }
  | { type: "append_biography"; personId: string; text: string }
  | { type: "create_spouse"; ofId: string; gender: "male" | "female" | null; nameFromAnswer: true; biography: string };

/** What the archivist could not settle while reading a document becomes a
 * question for the family rather than a line in a chat that scrolls away.
 *
 * The id is derived from the question itself, so re-reading the same document
 * does not ask the family the same thing twice, and a question they have
 * already answered stays answered. */
/* Documents the family sends, waiting to be read.
 *
 * An upload should not have to be watched. A file goes to R2 and a row goes
 * here; something drains the queue afterwards and the reader can close the
 * tab. Rows survive processing as part of the archive's record; explicitly
 * deleting their attachment removes the unusable queue reference too. */

export type QueuedDocument = {
  id: string; attachmentId: string; filename: string; uploadedBy: string;
  status: "pending" | "reading" | "read" | "failed"; result: string | null;
  createdAt: string; processedAt: string | null;
};

export async function queueDocument(attachmentId: string, filename: string, uploadedBy: string): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO document_queue (id, attachment_id, filename, uploaded_by, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)`).bind(crypto.randomUUID(), attachmentId, filename, uploadedBy, now).run();
}

export async function listDocumentQueue(limit = 40): Promise<QueuedDocument[]> {
  await ensureSchema();
  const result = await env.DB.prepare(`SELECT id, attachment_id AS attachmentId, filename, uploaded_by AS uploadedBy,
    status, result, created_at AS createdAt, processed_at AS processedAt
    FROM document_queue ORDER BY created_at DESC LIMIT ?`).bind(limit).all<QueuedDocument>();
  return result.results;
}

/** Takes the oldest waiting document and marks it as being read, so two
 *  drains running at once cannot read the same file twice.
 *
 *  A claim that never finishes - the request was abandoned, the tab closed,
 *  the Worker cut off mid-read - would otherwise strand that document in
 *  "reading" for good, so a claim older than ten minutes is treated as
 *  abandoned and the document goes back in the queue. Ten minutes is well
 *  past any real read and short enough that nobody waits on it. */
const CLAIM_MINUTES = 10;

export async function claimNextDocument(): Promise<QueuedDocument | null> {
  await ensureSchema();
  const stale = new Date(Date.now() - CLAIM_MINUTES * 60_000).toISOString();
  const row = await env.DB.prepare(`SELECT id, attachment_id AS attachmentId, filename, uploaded_by AS uploadedBy,
    status, result, created_at AS createdAt, processed_at AS processedAt
    FROM document_queue
    WHERE status = 'pending' OR (status = 'reading' AND (processed_at IS NULL OR processed_at < ?))
    ORDER BY created_at LIMIT 1`).bind(stale).first<QueuedDocument>();
  if (!row) return null;
  const now = new Date().toISOString();
  // processed_at doubles as "last touched": set on the claim so an abandoned
  // one can be recognised, and overwritten when the read finishes
  const claimed = await env.DB.prepare(`UPDATE document_queue SET status = 'reading', processed_at = ?
    WHERE id = ? AND (status = 'pending' OR (status = 'reading' AND (processed_at IS NULL OR processed_at < ?)))`)
    .bind(now, row.id, stale).run();
  if (!claimed.meta.changes) return null;
  return { ...row, status: "reading" };
}

export async function finishDocument(id: string, status: "read" | "failed", result: string): Promise<void> {
  await ensureSchema();
  await env.DB.prepare("UPDATE document_queue SET status = ?, result = ?, processed_at = ? WHERE id = ?")
    .bind(status, result.slice(0, 2000), new Date().toISOString(), id).run();
}

export async function retryDocument(id: string, actorEmail: string): Promise<boolean> {
  await ensureSchema();
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`UPDATE document_queue SET status = 'pending', result = NULL, processed_at = NULL
    WHERE id = ? AND status = 'failed'`).bind(id).run();
  if (!changed.meta.changes) return false;
  await env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, 'retry_document', 'Retried document reading', ?, ?)")
    .bind(crypto.randomUUID(), actorEmail, JSON.stringify({ documentId: id }), now).run();
  return true;
}

export async function cancelDocument(id: string, actorEmail: string): Promise<boolean> {
  await ensureSchema();
  const now = new Date().toISOString();
  const changed = await env.DB.prepare("DELETE FROM document_queue WHERE id = ? AND status IN ('pending', 'failed')").bind(id).run();
  if (!changed.meta.changes) return false;
  await env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, 'cancel_document', 'Cancelled document reading', ?, ?)")
    .bind(crypto.randomUUID(), actorEmail, JSON.stringify({ documentId: id }), now).run();
  return true;
}

export async function readAttachmentBytes(attachmentId: string): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null> {
  await ensureSchema();
  const row = await env.DB.prepare("SELECT object_key AS objectKey, content_type AS contentType, filename FROM attachments WHERE id = ?")
    .bind(attachmentId).first<{ objectKey: string; contentType: string; filename: string }>();
  if (!row) return null;
  const object = await env.FILES.get(row.objectKey);
  if (!object) return null;
  return { bytes: new Uint8Array(await object.arrayBuffer()), contentType: row.contentType, filename: row.filename };
}

export async function recordAgentQuestions(
  conflicts: { question: string; reason: string; candidatePersonIds: string[]; evidence: string[] }[],
  actorEmail: string,
): Promise<number> {
  if (!conflicts.length) return 0;
  await ensureSchema();
  const now = new Date().toISOString();
  const statements = [];
  for (const conflict of conflicts) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(conflict.question)));
    const id = `agent-${[...digest.slice(0, 10)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    const evidence = [conflict.reason, ...conflict.evidence].filter(Boolean).join(" · ") || null;
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO open_questions
      (id, question, evidence, action_summary, proposal_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`)
      .bind(id, conflict.question, evidence, "Answer here and an editor will apply it.",
        JSON.stringify({ candidatePersonIds: conflict.candidatePersonIds }), now));
  }
  statements.push(env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actorEmail, "agent_questions",
      `Reading what was sent raised ${conflicts.length} question${conflicts.length === 1 ? "" : "s"} for the family`,
      JSON.stringify({ questions: conflicts.map((conflict) => conflict.question) }), now));
  await env.DB.batch(statements);
  return conflicts.length;
}

/* Changes proposed by external agents over MCP. Additive kinds only: an
 * agent can suggest a person, a relationship, or a story, and nothing else.
 * Deletes, merges, and updates stay with the humans and the in-app
 * archivist. A proposal touches the tree only when an editor applies it. */

const AGENT_PROPOSAL_KINDS = new Set(["add_person", "add_relationship", "add_story"]);

export type AgentProposal = {
  id: string;
  proposal: ChangeProposal;
  summary: string;
  submittedBy: string;
  clientName: string;
  note: string | null;
  status: "pending" | "applied" | "rejected";
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
};

export async function submitAgentProposal(proposal: ChangeProposal, submittedBy: string, clientName: string, note: string | null): Promise<string> {
  if (!AGENT_PROPOSAL_KINDS.has(proposal.kind)) throw new Error("agent_proposal_kind_not_allowed");
  await ensureSchema();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO agent_proposals (id, proposal_json, summary, submitted_by, client_name, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, JSON.stringify(proposal), proposal.summary, submittedBy, clientName, note, now),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), submittedBy, "agent_proposal_submitted", `${clientName} proposed: ${proposal.summary}`, JSON.stringify({ proposalId: id, kind: proposal.kind }), now),
  ]);
  return id;
}

export async function listAgentProposals(filter?: { submittedBy?: string; status?: AgentProposal["status"] }): Promise<AgentProposal[]> {
  await ensureSchema();
  const conditions: string[] = [];
  const bindings: string[] = [];
  if (filter?.submittedBy) { conditions.push("submitted_by = ?"); bindings.push(filter.submittedBy); }
  if (filter?.status) { conditions.push("status = ?"); bindings.push(filter.status); }
  const rows = await env.DB.prepare(`SELECT id, proposal_json AS proposalJson, summary, submitted_by AS submittedBy,
      client_name AS clientName, note, status, created_at AS createdAt, decided_by AS decidedBy, decided_at AS decidedAt
      FROM agent_proposals ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 100`)
    .bind(...bindings)
    .all<Omit<AgentProposal, "proposal"> & { proposalJson: string }>();
  return rows.results.map(({ proposalJson, ...row }) => ({ ...row, proposal: JSON.parse(proposalJson) as ChangeProposal }));
}

export async function decideAgentProposal(id: string, verdict: "apply" | "reject", actorEmail: string): Promise<{ status: "applied" | "rejected" }> {
  await ensureSchema();
  const now = new Date().toISOString();
  const status = verdict === "apply" ? "applied" : "rejected";
  // single-statement claim: a second decision on the same proposal updates zero rows
  const claimed = await env.DB.prepare(`UPDATE agent_proposals SET status = ?, decided_by = ?, decided_at = ?
      WHERE id = ? AND status = 'pending'
      RETURNING proposal_json AS proposalJson, submitted_by AS submittedBy, client_name AS clientName, note`)
    .bind(status, actorEmail, now, id)
    .first<{ proposalJson: string; submittedBy: string; clientName: string; note: string | null }>();
  if (!claimed) throw new Error("proposal_not_pending");
  if (verdict === "reject") {
    await env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "agent_proposal_rejected", `Rejected an agent proposal`, JSON.stringify({ proposalId: id }), now).run();
    return { status: "rejected" };
  }
  const proposal = JSON.parse(claimed.proposalJson) as ChangeProposal;
  try {
    await applyProposal(proposal, actorEmail, {
      sourceType: "agent",
      sourceLabel: `${claimed.clientName} via ${claimed.submittedBy}`,
      sourceExcerpt: claimed.note,
      confidence: 70,
    });
  } catch (error) {
    // the apply failed, so the decision did not happen; put it back for review
    await env.DB.prepare("UPDATE agent_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ?").bind(id).run();
    throw error;
  }
  return { status: "applied" };
}

export type AgentConnection = { id: string; clientName: string; scope: string; createdAt: string; lastUsedAt: string | null; expiresAt: string };

/** The MCP connections (token families) a member has approved and can end
 * from Settings. Access tokens rotate inside a family; the family is the
 * durable thing a person recognizes and revokes. */
export async function listAgentConnections(memberEmail: string): Promise<AgentConnection[]> {
  await ensureSchema();
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`SELECT id, client_name AS clientName, scope, created_at AS createdAt,
      last_used_at AS lastUsedAt, absolute_expires_at AS expiresAt FROM agent_token_families
      WHERE member_email = ? AND revoked_at IS NULL AND absolute_expires_at > ? AND inactivity_expires_at > ?
      ORDER BY created_at DESC`)
    .bind(memberEmail, now, now)
    .all<AgentConnection>();
  return rows.results;
}

export async function revokeAgentConnection(familyId: string, memberEmail: string): Promise<boolean> {
  await ensureSchema();
  const now = new Date().toISOString();
  const result = await env.DB.prepare("UPDATE agent_token_families SET revoked_at = ? WHERE id = ? AND member_email = ? AND revoked_at IS NULL")
    .bind(now, familyId, memberEmail).run();
  if (result.meta.changes > 0) {
    await env.DB.batch([
      env.DB.prepare("UPDATE agent_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL").bind(now, familyId),
      env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), memberEmail, "agent_disconnected", "Disconnected an assistant", JSON.stringify({ connectionId: familyId }), now),
    ]);
  }
  return result.meta.changes > 0;
}

export async function listOpenQuestions(): Promise<OpenQuestion[]> {
  await ensureSchema();
  // Consistency problems are derived, not stored: the checker runs against the
  // live tree each time, so a question disappears the moment the records stop
  // disagreeing. Only the family's verdicts are persisted - a denied check
  // stays denied by id even though the check itself is recomputed.
  const [result, answered, tree] = await Promise.all([
    env.DB.prepare(`SELECT id, question, evidence, action_summary AS actionSummary, proposal_json AS proposalJson, status, created_at AS createdAt
      FROM open_questions WHERE status = 'open' ORDER BY created_at`).all<{ id: string; question: string; evidence: string | null; actionSummary: string | null; proposalJson: string | null; status: "open"; createdAt: string }>(),
    env.DB.prepare("SELECT id FROM open_questions WHERE status != 'open'").all<{ id: string }>(),
    readTree(),
  ]);
  const settled = new Set(answered.results.map((row) => row.id));
  const derived: OpenQuestion[] = runRecordChecks(tree)
    .filter((check) => !settled.has(check.id) && !result.results.some((row) => row.id === check.id))
    .map((check) => ({
      id: check.id, question: check.question, evidence: check.evidence,
      actionSummary: check.kind === "duplicate"
        ? "Answering records the verdict; an editor merges them if they are one person."
        : "Your answer is recorded for an editor to apply.",
      needsAnswerText: false,
      choices: check.choices,
      status: "open" as const, createdAt: "",
    }));
  const meta = (json: string | null) => {
    if (!json) return {} as { choices?: OpenQuestion["choices"]; imageId?: string | null };
    try { const parsed = JSON.parse(json); return { choices: parsed.choices, imageId: parsed.imageId ?? null }; } catch { return {}; }
  };
  return [...result.results.map((row) => ({
    id: row.id, question: row.question, evidence: row.evidence, actionSummary: row.actionSummary,
    needsAnswerText: Boolean(row.proposalJson && JSON.parse(row.proposalJson).actions?.some((action: QuestionAction) => "nameFromAnswer" in action && action.nameFromAnswer)),
    ...meta(row.proposalJson),
    status: row.status, createdAt: row.createdAt,
  })), ...derived];
}

export async function answerQuestion(id: string, verdict: "confirm" | "deny", note: string | null, actorEmail: string): Promise<FamilyTree> {
  await ensureSchema();
  let row = await env.DB.prepare("SELECT question, proposal_json AS proposalJson, status FROM open_questions WHERE id = ?")
    .bind(id).first<{ question: string; proposalJson: string | null; status: string }>();
  if (!row && id.startsWith("chk-")) {
    // a derived consistency check: persist it at the moment it is answered so
    // the verdict survives, then fall through to the normal path
    const check = runRecordChecks(await readTree()).find((candidate) => candidate.id === id);
    if (!check) throw new Error("question_not_found");
    const created = new Date().toISOString();
    await env.DB.prepare("INSERT OR IGNORE INTO open_questions (id, question, evidence, action_summary, proposal_json, status, created_at) VALUES (?, ?, ?, ?, NULL, 'open', ?)")
      .bind(id, check.question, check.evidence, null, created).run();
    row = { question: check.question, proposalJson: null, status: "open" };
  }
  if (!row) throw new Error("question_not_found");
  if (row.status !== "open") throw new Error("question_already_answered");
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(CLAIM_QUESTION_ANSWER_SQL).bind(id, now),
  ];
  const applied: string[] = [];
  if (verdict === "confirm" && row.proposalJson) {
    const actions = (JSON.parse(row.proposalJson).actions ?? []) as QuestionAction[];
    const invariants = new MutationInvariants(await readTree());
    for (const action of actions) {
      if (action.type === "add_parent") {
        invariants.addRelationship(action.parentId, action.childId, "parent");
        const relationshipId = crypto.randomUUID();
        statements.push(env.DB.prepare("INSERT INTO relationships (id, from_person_id, to_person_id, type, created_at) VALUES (?, ?, ?, 'parent', ?)")
          .bind(relationshipId, action.parentId, action.childId, now));
        statements.push(...claimStatements("relationship", relationshipId, [
          ["fromPersonId", action.parentId], ["toPersonId", action.childId], ["type", "parent"],
        ], actorEmail, now, { sourceType: "family_assertion", sourceLabel: `Answer from ${actorEmail}`, sourceExcerpt: note }));
        applied.push("parent link added");
      } else if (action.type === "append_biography") {
        invariants.person(action.personId);
        const person = await env.DB.prepare("SELECT biography FROM people WHERE id = ?").bind(action.personId).first<{ biography: string | null }>();
        if (!person) throw new Error("That person is no longer in the tree.");
        const current = person.biography?.trim() ?? "";
        if (!current.includes(action.text.slice(0, 40))) {
          const next = current ? `${current}${current.endsWith(".") ? "" : "."} ${action.text}` : action.text;
          statements.push(env.DB.prepare("UPDATE people SET biography = ?, updated_at = ? WHERE id = ?").bind(next, now, action.personId));
          statements.push(...claimStatements("person", action.personId, [["biography", next]], actorEmail, now,
            { sourceType: "family_assertion", sourceLabel: `Answer from ${actorEmail}`, sourceExcerpt: note }));
          applied.push("biography updated");
        }
      } else if (action.type === "create_spouse") {
        const name = note?.trim();
        if (!name) throw new Error("answer_name_required");
        const personId = crypto.randomUUID();
        const relationshipId = crypto.randomUUID();
        invariants.addPerson(personId);
        invariants.addRelationship(action.ofId, personId, "spouse");
        statements.push(env.DB.prepare("INSERT INTO people (id, display_name, gender, biography, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(personId, name, action.gender, action.biography, now, now));
        statements.push(...claimStatements("person", personId, [["displayName", name], ["gender", action.gender], ["biography", action.biography]], actorEmail, now,
          { sourceType: "family_assertion", sourceLabel: `Answer from ${actorEmail}`, sourceExcerpt: note }));
        statements.push(env.DB.prepare("INSERT INTO relationships (id, from_person_id, to_person_id, type, created_at) VALUES (?, ?, ?, 'spouse', ?)")
          .bind(relationshipId, action.ofId, personId, now));
        statements.push(...claimStatements("relationship", relationshipId, [["fromPersonId", action.ofId], ["toPersonId", personId], ["type", "spouse"]], actorEmail, now,
          { sourceType: "family_assertion", sourceLabel: `Answer from ${actorEmail}`, sourceExcerpt: note }));
        applied.push(`added ${name} as spouse`);
      }
    }
  }
  statements.push(env.DB.prepare("UPDATE open_questions SET status = ?, answer_note = ?, answered_by = ?, answered_at = ? WHERE id = ? AND status = 'open'")
    .bind(verdict === "confirm" ? "confirmed" : "denied", note?.trim() || null, actorEmail, now, id));
  statements.push(env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actorEmail, "answer_question",
      `${verdict === "confirm" ? "Confirmed" : "Denied"}: ${row.question}`,
      JSON.stringify({ questionId: id, verdict, note: note?.trim() || null, applied }), now));
  await env.DB.batch(statements);
  treeJsonCache = null;
  return readTree();
}


// ---------- photo galleries ----------
/** One photograph, many people: a group portrait is linked to each person in
 * it rather than duplicated. The portrait is whichever gallery photo the
 * person's photo_attachment_id points at. */
export async function setPersonPortrait(personId: string, attachmentId: string | null, actorEmail: string) {
  await ensureSchema();
  if (attachmentId) {
    const target = await photoTargetState(personId, attachmentId);
    requirePhotoTargets(target);
    if (target.portraitMatches) return readTree();
  } else {
    await requirePersonTarget(personId);
    const current = await env.DB.prepare("SELECT photo_attachment_id AS photoAttachmentId FROM people WHERE id = ?")
      .bind(personId).first<{ photoAttachmentId: string | null }>();
    if (!current?.photoAttachmentId) return readTree();
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE people SET photo_attachment_id = ?, updated_at = ? WHERE id = ? AND photo_attachment_id IS NOT ?")
      .bind(attachmentId, now, personId, attachmentId),
    env.DB.prepare(`INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
      .bind(crypto.randomUUID(), actorEmail, "set_person_portrait", attachmentId ? "Chose a portrait" : "Cleared a portrait", JSON.stringify({ personId, attachmentId }), now),
    ...claimStatements("person", personId, [["photoAttachmentId", attachmentId]], actorEmail, now, defaultClaimSource(actorEmail)),
  ]);
  treeJsonCache = null;
  return readTree();
}

export async function linkPersonPhoto(personId: string, attachmentId: string, actorEmail: string) {
  await ensureSchema();
  const target = await photoTargetState(personId, attachmentId);
  requirePhotoTargets(target);
  // Linking is idempotent, but an idempotent retry is not a new audited change.
  if (target.linkExists) return readTree();
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO person_photos (person_id, attachment_id, created_at) VALUES (?, ?, ?)").bind(personId, attachmentId, now),
    env.DB.prepare(`INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`)
      .bind(auditId, actorEmail, "link_person_photo", "Added someone to a photograph", JSON.stringify({ personId, attachmentId }), now),
    env.DB.prepare(`UPDATE people SET photo_attachment_id = COALESCE(photo_attachment_id, ?), updated_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM change_log WHERE id = ?)`)
      .bind(attachmentId, now, personId, auditId),
  ]);
  treeJsonCache = null;
  return readTree();
}

export async function unlinkPersonPhoto(personId: string, attachmentId: string, actorEmail: string) {
  await ensureSchema();
  const target = await photoTargetState(personId, attachmentId);
  requirePhotoTargets(target);
  if (!target.linkExists && !target.portraitMatches) return readTree();
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM person_photos WHERE person_id = ? AND attachment_id = ?
      ) OR EXISTS (
        SELECT 1 FROM people WHERE id = ? AND photo_attachment_id = ?
      )`)
      .bind(auditId, actorEmail, "unlink_person_photo", "Removed a photograph from a record", JSON.stringify({ personId, attachmentId }), now,
        personId, attachmentId, personId, attachmentId),
    env.DB.prepare(`DELETE FROM person_photos WHERE person_id = ? AND attachment_id = ?
      AND EXISTS (SELECT 1 FROM change_log WHERE id = ?)`)
      .bind(personId, attachmentId, auditId),
    // dropping the portrait promotes whatever else the person still has
    env.DB.prepare(`UPDATE people SET photo_attachment_id = (SELECT attachment_id FROM person_photos WHERE person_id = ? ORDER BY created_at LIMIT 1), updated_at = ?
      WHERE id = ? AND photo_attachment_id = ? AND EXISTS (SELECT 1 FROM change_log WHERE id = ?)`)
      .bind(personId, now, personId, attachmentId, auditId),
  ]);
  treeJsonCache = null;
  return readTree();
}


// ---------- the record of who changed what ----------
export type ChangeEntry = { id: string; actorEmail: string; kind: string; summary: string; createdAt: string; undoStatus: "active" | "undoing" | "undone" | null };

/** Newest first, a page at a time. Every mutation in the archive writes here,
 * so this is the full account of who did what. */
export async function listChangeLog(before?: string | null, limit = 60): Promise<{ entries: ChangeEntry[]; nextBefore: string | null }> {
  await ensureSchema();
  const rows = before
    ? await env.DB.prepare(`SELECT change_log.id, actor_email AS actorEmail, kind, summary, created_at AS createdAt, undo_entries.status AS undoStatus
        FROM change_log LEFT JOIN undo_entries ON undo_entries.change_id = change_log.id
        WHERE created_at < ? ORDER BY created_at DESC LIMIT ?`).bind(before, limit + 1).all<ChangeEntry>()
    : await env.DB.prepare(`SELECT change_log.id, actor_email AS actorEmail, kind, summary, created_at AS createdAt, undo_entries.status AS undoStatus
        FROM change_log LEFT JOIN undo_entries ON undo_entries.change_id = change_log.id
        ORDER BY created_at DESC LIMIT ?`).bind(limit + 1).all<ChangeEntry>();
  const entries = rows.results.slice(0, limit);
  return { entries, nextBefore: rows.results.length > limit ? entries[entries.length - 1]?.createdAt ?? null : null };
}

const rowValue = (row: Record<string, unknown>, key: string) => (row[key] ?? null) as string | number | null;

async function restoreMerge(changeId: string, actorEmail: string): Promise<FamilyTree> {
  const stored = await env.DB.prepare(`SELECT source_person_id AS sourcePersonId, target_person_id AS targetPersonId,
    snapshot_json AS snapshotJson, merged_at AS mergedAt, restored_at AS restoredAt FROM merge_snapshots WHERE change_id = ?`)
    .bind(changeId).first<{ sourcePersonId: string; targetPersonId: string; snapshotJson: string; mergedAt: string; restoredAt: string | null }>();
  if (!stored || stored.restoredAt) throw new Error("That merge can no longer be split.");
  const later = await env.DB.prepare(`SELECT COUNT(*) AS count FROM change_log WHERE created_at > ? AND id != ?
    AND (instr(payload_json, ?) > 0 OR instr(payload_json, ?) > 0)`)
    .bind(stored.mergedAt, changeId, stored.sourcePersonId, stored.targetPersonId).first<{ count: number }>();
  if (later?.count) throw new Error("This person changed after the merge. Undo those later changes before splitting the records.");
  const snapshot = JSON.parse(stored.snapshotJson) as MergeSnapshot;
  const sourceExists = await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(stored.sourcePersonId).first<{ id: string }>();
  const targetExists = await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(stored.targetPersonId).first<{ id: string }>();
  if (sourceExists || !targetExists) throw new Error("The merged records are no longer in the expected state.");
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM evidence_claims WHERE subject_type = 'relationship' AND subject_id IN
      (SELECT id FROM relationships WHERE from_person_id = ? OR to_person_id = ?)`)
      .bind(stored.targetPersonId, stored.targetPersonId),
    env.DB.prepare("DELETE FROM relationships WHERE from_person_id = ? OR to_person_id = ?").bind(stored.targetPersonId, stored.targetPersonId),
    env.DB.prepare("DELETE FROM story_people WHERE person_id IN (?, ?)").bind(stored.sourcePersonId, stored.targetPersonId),
    env.DB.prepare("DELETE FROM person_photos WHERE person_id IN (?, ?)").bind(stored.sourcePersonId, stored.targetPersonId),
    env.DB.prepare("DELETE FROM person_comments WHERE person_id IN (?, ?)").bind(stored.sourcePersonId, stored.targetPersonId),
    env.DB.prepare("UPDATE members SET person_id = NULL, updated_at = ? WHERE person_id IN (?, ?)").bind(now, stored.sourcePersonId, stored.targetPersonId),
    env.DB.prepare("DELETE FROM evidence_claims WHERE subject_type = 'person' AND subject_id IN (?, ?)").bind(stored.sourcePersonId, stored.targetPersonId),
    env.DB.prepare("DELETE FROM people WHERE id IN (?, ?)").bind(stored.sourcePersonId, stored.targetPersonId),
  ];
  for (const row of snapshot.people) statements.push(env.DB.prepare(`INSERT INTO people
    (id, display_name, gender, given_name, family_name, birth_date, death_date, birth_place, death_place, birth_city, birth_country,
     death_city, death_country, biography, photo_attachment_id, created_at, updated_at, maiden_name, burial_place, residence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(...["id", "display_name", "gender", "given_name", "family_name", "birth_date", "death_date", "birth_place", "death_place",
      "birth_city", "birth_country", "death_city", "death_country", "biography", "photo_attachment_id", "created_at", "updated_at",
      "maiden_name", "burial_place", "residence"].map((key) => rowValue(row, key))));
  for (const row of snapshot.relationships) statements.push(env.DB.prepare(`INSERT INTO relationships
    (id, from_person_id, to_person_id, type, created_at, status) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(...["id", "from_person_id", "to_person_id", "type", "created_at", "status"].map((key) => rowValue(row, key))));
  for (const row of snapshot.storyPeople) statements.push(env.DB.prepare("INSERT OR IGNORE INTO story_people (story_id, person_id) VALUES (?, ?)")
    .bind(rowValue(row, "story_id"), rowValue(row, "person_id")));
  for (const row of snapshot.personPhotos) statements.push(env.DB.prepare("INSERT OR IGNORE INTO person_photos (person_id, attachment_id, created_at) VALUES (?, ?, ?)")
    .bind(rowValue(row, "person_id"), rowValue(row, "attachment_id"), rowValue(row, "created_at")));
  for (const row of snapshot.comments) statements.push(env.DB.prepare(`INSERT INTO person_comments
    (id, person_id, author_email, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(...["id", "person_id", "author_email", "author_name", "body", "created_at"].map((key) => rowValue(row, key))));
  for (const row of snapshot.members) statements.push(env.DB.prepare(`UPDATE members SET role = ?, person_id = ?, added_by = ?, created_at = ?, updated_at = ? WHERE email = ?`)
    .bind(...["role", "person_id", "added_by", "created_at", "updated_at", "email"].map((key) => rowValue(row, key))));
  for (const row of snapshot.claims) statements.push(env.DB.prepare(`INSERT INTO evidence_claims
    (id, subject_type, subject_id, predicate, value, status, confidence, source_type, attachment_id, source_label,
     source_locator, source_excerpt, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(...["id", "subject_type", "subject_id", "predicate", "value", "status", "confidence", "source_type", "attachment_id",
      "source_label", "source_locator", "source_excerpt", "created_by", "created_at", "updated_at"].map((key) => rowValue(row, key))));
  for (const row of snapshot.questions) statements.push(env.DB.prepare("UPDATE open_questions SET proposal_json = ? WHERE id = ?")
    .bind(rowValue(row, "proposal_json"), rowValue(row, "id")));
  statements.push(
    env.DB.prepare("UPDATE merge_snapshots SET restored_at = ? WHERE change_id = ? AND restored_at IS NULL").bind(now, changeId),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, 'split_people', ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "Undid a duplicate-person merge", JSON.stringify({ mergeChangeId: changeId, sourcePersonId: stored.sourcePersonId, targetPersonId: stored.targetPersonId }), now),
  );
  await env.DB.batch(statements);
  treeJsonCache = null;
  return readTree();
}

async function restoreDeletedPerson(changeId: string, actorEmail: string): Promise<FamilyTree> {
  const stored = await env.DB.prepare(`SELECT person_id AS personId, snapshot_json AS snapshotJson,
    deleted_at AS deletedAt, restored_at AS restoredAt FROM person_deletion_snapshots WHERE change_id = ?`)
    .bind(changeId).first<{ personId: string; snapshotJson: string; deletedAt: string; restoredAt: string | null }>();
  if (!stored || stored.restoredAt) throw new Error("That deletion can no longer be restored.");
  if (await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(stored.personId).first<{ id: string }>()) {
    throw new Error("A person already occupies the deleted record's identity.");
  }
  const snapshot = JSON.parse(stored.snapshotJson) as MergeSnapshot;
  const currentTree = await readTree();
  const currentSignatures = new Set(currentTree.relationships.map(relationshipSignature));
  for (const row of snapshot.relationships) {
    const signature = relationshipSignature({
      fromPersonId: String(row.from_person_id), toPersonId: String(row.to_person_id), type: row.type as Relationship["type"],
    });
    if (currentSignatures.has(signature)) throw new Error("A matching family relationship was added after deletion. Remove it before restoring this record.");
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const row of snapshot.people) statements.push(env.DB.prepare(`INSERT INTO people
    (id, display_name, gender, given_name, family_name, birth_date, death_date, birth_place, death_place, birth_city, birth_country,
     death_city, death_country, biography, photo_attachment_id, created_at, updated_at, maiden_name, burial_place, residence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(...["id", "display_name", "gender", "given_name", "family_name", "birth_date", "death_date", "birth_place", "death_place",
      "birth_city", "birth_country", "death_city", "death_country", "biography", "photo_attachment_id", "created_at", "updated_at",
      "maiden_name", "burial_place", "residence"].map((key) => rowValue(row, key))));
  for (const row of snapshot.relationships) statements.push(env.DB.prepare(`INSERT INTO relationships
    (id, from_person_id, to_person_id, type, created_at, status) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(...["id", "from_person_id", "to_person_id", "type", "created_at", "status"].map((key) => rowValue(row, key))));
  for (const row of snapshot.storyPeople) statements.push(env.DB.prepare("INSERT OR IGNORE INTO story_people (story_id, person_id) VALUES (?, ?)")
    .bind(rowValue(row, "story_id"), rowValue(row, "person_id")));
  for (const row of snapshot.personPhotos) statements.push(env.DB.prepare("INSERT OR IGNORE INTO person_photos (person_id, attachment_id, created_at) VALUES (?, ?, ?)")
    .bind(rowValue(row, "person_id"), rowValue(row, "attachment_id"), rowValue(row, "created_at")));
  for (const row of snapshot.comments) statements.push(env.DB.prepare(`INSERT INTO person_comments
    (id, person_id, author_email, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(...["id", "person_id", "author_email", "author_name", "body", "created_at"].map((key) => rowValue(row, key))));
  for (const row of snapshot.members) statements.push(env.DB.prepare(`UPDATE members SET role = ?, person_id = ?, added_by = ?, created_at = ?, updated_at = ? WHERE email = ?`)
    .bind(...["role", "person_id", "added_by", "created_at", "updated_at", "email"].map((key) => rowValue(row, key))));
  for (const row of snapshot.claims) statements.push(env.DB.prepare(`INSERT INTO evidence_claims
    (id, subject_type, subject_id, predicate, value, status, confidence, source_type, attachment_id, source_label,
     source_locator, source_excerpt, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(...["id", "subject_type", "subject_id", "predicate", "value", "status", "confidence", "source_type", "attachment_id",
      "source_label", "source_locator", "source_excerpt", "created_by", "created_at", "updated_at"].map((key) => rowValue(row, key))));
  for (const row of snapshot.questions) statements.push(env.DB.prepare(`UPDATE open_questions SET question = ?, evidence = ?, action_summary = ?,
    proposal_json = ?, status = ?, answer_note = ?, answered_by = ?, answered_at = ?, created_at = ? WHERE id = ?`)
    .bind(...["question", "evidence", "action_summary", "proposal_json", "status", "answer_note", "answered_by", "answered_at", "created_at", "id"].map((key) => rowValue(row, key))));
  statements.push(
    env.DB.prepare("UPDATE person_deletion_snapshots SET restored_at = ? WHERE change_id = ? AND restored_at IS NULL").bind(now, changeId),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, 'restore_person', ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "Restored a deleted person", JSON.stringify({ deletionChangeId: changeId, personId: stored.personId }), now),
  );
  await env.DB.batch(statements);
  treeJsonCache = null;
  return readTree();
}

export async function undoChange(changeId: string, actorEmail: string): Promise<FamilyTree> {
  await ensureSchema();
  const claimed = await env.DB.prepare("UPDATE undo_entries SET status = 'undoing' WHERE change_id = ? AND status = 'active'")
    .bind(changeId).run();
  if (!claimed.meta.changes) throw new Error("That change cannot be undone, or was already undone.");
  try {
    const row = await env.DB.prepare("SELECT inverse_json AS inverseJson FROM undo_entries WHERE change_id = ?")
      .bind(changeId).first<{ inverseJson: string }>();
    const inverse = row ? JSON.parse(row.inverseJson) as unknown : null;
    const internal = inverse && typeof inverse === "object" ? inverse as { kind?: unknown; changeId?: unknown } : null;
    const tree = internal?.kind === "undo_merge" && typeof internal.changeId === "string"
      ? await restoreMerge(internal.changeId, actorEmail)
      : internal?.kind === "undo_delete_person" && typeof internal.changeId === "string"
        ? await restoreDeletedPerson(internal.changeId, actorEmail)
      : isChangeProposal(inverse)
        ? await applyProposal(inverse, actorEmail, { sourceType: "manual", sourceLabel: `Undo by ${actorEmail}`, confidence: 100 })
        : (() => { throw new Error("The saved undo operation is invalid."); })();
    await env.DB.prepare("UPDATE undo_entries SET status = 'undone', undone_by = ?, undone_at = ? WHERE change_id = ? AND status = 'undoing'")
      .bind(actorEmail, new Date().toISOString(), changeId).run();
    return tree;
  } catch (error) {
    await env.DB.prepare("UPDATE undo_entries SET status = 'active' WHERE change_id = ? AND status = 'undoing'").bind(changeId).run();
    throw error;
  }
}

// ---------- comments ----------
export type PersonComment = { id: string; personId: string; authorName: string; body: string; createdAt: string; mine?: boolean };

export async function listComments(): Promise<PersonComment[]> {
  await ensureSchema();
  const rows = await env.DB.prepare(`SELECT id, person_id AS personId, author_email AS authorEmail, author_name AS authorName, body, created_at AS createdAt
    FROM person_comments ORDER BY created_at`).all<PersonComment & { authorEmail: string }>();
  return rows.results.map(({ authorEmail, ...comment }) => ({ ...comment, authorName: comment.authorName || authorEmail.split("@")[0] }));
}

export async function addComment(personId: string, body: string, actorEmail: string, authorName: string | null): Promise<PersonComment[]> {
  await ensureSchema();
  const text = body.trim().slice(0, 4000);
  if (!personId || !text) throw new Error("comment_required");
  await requirePersonTarget(personId);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO person_comments (id, person_id, author_email, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), personId, actorEmail, authorName, text, now),
    env.DB.prepare("INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), actorEmail, "add_comment", "Left a comment on a record", JSON.stringify({ personId }), now),
  ]);
  return listComments();
}

/** Anyone may delete their own; an admin may delete any. */
export async function removeComment(commentId: string, actorEmail: string, isAdmin: boolean): Promise<PersonComment[]> {
  await ensureSchema();
  const owner = await env.DB.prepare("SELECT author_email AS authorEmail FROM person_comments WHERE id = ?").bind(commentId).first<{ authorEmail: string }>();
  if (!owner) throw new Error("comment_not_found");
  if (!isAdmin && owner.authorEmail.toLocaleLowerCase() !== actorEmail.toLocaleLowerCase()) throw new Error("not_your_comment");
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const [claimed] = await env.DB.batch([
    // Re-check existence and authorization inside the write transaction. A
    // concurrent removal therefore cannot leave a false successful audit.
    env.DB.prepare(`INSERT INTO change_log (id, actor_email, kind, summary, payload_json, created_at)
      SELECT ?, ?, ?, ?, ?, ? FROM person_comments
      WHERE id = ? AND (? = 1 OR author_email = ?)`)
      .bind(auditId, actorEmail, "remove_comment", "Removed a comment", JSON.stringify({ commentId }), now,
        commentId, isAdmin ? 1 : 0, owner.authorEmail),
    env.DB.prepare(`DELETE FROM person_comments WHERE id = ?
      AND EXISTS (SELECT 1 FROM change_log WHERE id = ?)`)
      .bind(commentId, auditId),
  ]);
  if (!claimed.meta.changes) throw new Error("comment_not_found");
  return listComments();
}
