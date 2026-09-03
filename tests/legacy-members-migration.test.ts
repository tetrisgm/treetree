import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_MEMBER_ROLE_MIGRATION_SQL, MEMBERS_PERSON_INDEX_SQL } from "../db/legacy-migrations";

const databases: DatabaseSync[] = [];

function legacyDatabase() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE members (
    email TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer')),
    person_id TEXT,
    added_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    for (const sql of LEGACY_MEMBER_ROLE_MIGRATION_SQL) db.exec(sql);
    db.exec(MEMBERS_PERSON_INDEX_SQL);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("legacy member-role migration", () => {
  it("maps legacy roles without losing account-to-person claims", () => {
    const db = legacyDatabase();
    const insert = db.prepare("INSERT INTO members VALUES (?, ?, ?, ?, ?, ?)");
    insert.run("admin@example.com", "admin", "person-admin", "seed", "created-a", "updated-a");
    insert.run("editor@example.com", "editor", "person-editor", "owner", "created-b", "updated-b");
    insert.run("viewer@example.com", "viewer", null, "owner", "created-c", "updated-c");

    migrate(db);

    expect(db.prepare("SELECT * FROM members ORDER BY email").all()).toEqual([
      { email: "admin@example.com", role: "admin", person_id: "person-admin", added_by: "seed", created_at: "created-a", updated_at: "updated-a" },
      { email: "editor@example.com", role: "canEdit", person_id: "person-editor", added_by: "owner", created_at: "created-b", updated_at: "updated-b" },
      { email: "viewer@example.com", role: "canView", person_id: null, added_by: "owner", created_at: "created-c", updated_at: "updated-c" },
    ]);
    expect(() => db.prepare("INSERT INTO members VALUES (?, ?, ?, ?, ?, ?)")
      .run("duplicate@example.com", "canView", "person-editor", "owner", "created-d", "updated-d"))
      .toThrow();
  });

  it("discards debris from an interrupted earlier rebuild", () => {
    const db = legacyDatabase();
    db.prepare("INSERT INTO members VALUES (?, ?, ?, ?, ?, ?)")
      .run("real@example.com", "editor", "person-real", "owner", "created", "updated");
    db.exec(`CREATE TABLE members_next (
      email TEXT PRIMARY KEY, role TEXT, person_id TEXT, added_by TEXT, created_at TEXT, updated_at TEXT
    )`);
    db.prepare("INSERT INTO members_next VALUES (?, ?, ?, ?, ?, ?)")
      .run("stale@example.com", "canView", "person-stale", "stale", "stale", "stale");

    migrate(db);

    expect(db.prepare("SELECT email, role, person_id FROM members").all()).toEqual([
      { email: "real@example.com", role: "canEdit", person_id: "person-real" },
    ]);
  });
});
