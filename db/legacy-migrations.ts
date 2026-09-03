/**
 * SQLite cannot alter the CHECK constraint on the legacy members table, so
 * deployments that still use the old editor/viewer role names need one table
 * rebuild. Keep this sequence separate and executable in a real SQLite test:
 * losing an account's person_id here disconnects that account from the tree.
 */
export const LEGACY_MEMBER_ROLE_MIGRATION_SQL = [
  "DROP TABLE IF EXISTS members_next",
  `CREATE TABLE members_next (
    email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin', 'canEdit', 'canView')),
    person_id TEXT, added_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `INSERT INTO members_next (email, role, person_id, added_by, created_at, updated_at)
    SELECT email, CASE role WHEN 'editor' THEN 'canEdit' WHEN 'viewer' THEN 'canView' ELSE role END,
    person_id, added_by, created_at, updated_at FROM members`,
  "DROP TABLE members",
  "ALTER TABLE members_next RENAME TO members",
] as const;

export const MEMBERS_PERSON_INDEX_SQL =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_members_person ON members(person_id) WHERE person_id IS NOT NULL";
