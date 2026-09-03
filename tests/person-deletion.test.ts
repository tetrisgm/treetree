import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { preparePersonDeletion } from "../db/person-deletion";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE people (id TEXT PRIMARY KEY, photo_attachment_id TEXT);
    CREATE TABLE relationships (id TEXT PRIMARY KEY, from_person_id TEXT NOT NULL, to_person_id TEXT NOT NULL);
    CREATE TABLE stories (id TEXT PRIMARY KEY);
    CREATE TABLE story_people (story_id TEXT NOT NULL, person_id TEXT NOT NULL);
    CREATE TABLE attachments (id TEXT PRIMARY KEY);
    CREATE TABLE story_attachments (story_id TEXT NOT NULL, attachment_id TEXT NOT NULL);
    CREATE TABLE person_comments (id TEXT PRIMARY KEY, person_id TEXT NOT NULL);
    CREATE TABLE person_photos (person_id TEXT NOT NULL, attachment_id TEXT NOT NULL);
    CREATE TABLE members (email TEXT PRIMARY KEY, person_id TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE open_questions (
      id TEXT PRIMARY KEY, proposal_json TEXT, status TEXT NOT NULL, answer_note TEXT,
      answered_by TEXT, answered_at TEXT
    );
    CREATE TABLE evidence_claims (id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL);

    INSERT INTO attachments VALUES ('shared-photo'), ('private-evidence');
    INSERT INTO stories VALUES ('story-1');
    INSERT INTO people VALUES ('deleted', 'shared-photo'), ('survivor', 'shared-photo');
    INSERT INTO relationships VALUES
      ('deleted-as-parent', 'deleted', 'survivor'),
      ('deleted-as-child', 'survivor', 'deleted');
    INSERT INTO story_people VALUES ('story-1', 'deleted'), ('story-1', 'survivor');
    INSERT INTO story_attachments VALUES ('story-1', 'private-evidence');
    INSERT INTO person_comments VALUES ('deleted-comment', 'deleted'), ('survivor-comment', 'survivor');
    INSERT INTO person_photos VALUES ('deleted', 'shared-photo'), ('survivor', 'shared-photo');
    INSERT INTO members VALUES
      ('claimed@example.com', 'deleted', 'earlier'),
      ('survivor@example.com', 'survivor', 'earlier');
    INSERT INTO open_questions VALUES
      ('depends-on-deleted', '{"actions":[{"personId":"deleted"}]}', 'open', NULL, NULL, NULL),
      ('similar-id', '{"actions":[{"personId":"deleted-extra"}]}', 'open', NULL, NULL, NULL),
      ('historical', '{"actions":[{"personId":"deleted"}]}', 'confirmed', 'Kept for history', 'member@example.com', 'earlier');
  `);
  return database;
}

function deletePerson(database: DatabaseSync, personId: string) {
  database.exec("BEGIN");
  try {
    const deletions = preparePersonDeletion({
      prepare(sql: string) {
        return {
          bind(...values: string[]) {
            return () => database.prepare(sql).run(...values);
          },
        };
      },
    }, { personId, actorEmail: "editor@example.com", deletedAt: "2026-08-30T12:00:00.000Z" });
    for (const run of deletions) run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

describe("complete person deletion", () => {
  it("removes every direct person dependency without deleting shared evidence or stories", () => {
    const database = fixture();
    try {
      deletePerson(database, "deleted");

      expect(database.prepare("SELECT id FROM people ORDER BY id").all()).toEqual([{ id: "survivor" }]);
      expect(database.prepare("SELECT * FROM relationships").all()).toEqual([]);
      expect(database.prepare("SELECT * FROM story_people").all()).toEqual([{ story_id: "story-1", person_id: "survivor" }]);
      expect(database.prepare("SELECT * FROM person_comments").all()).toEqual([{ id: "survivor-comment", person_id: "survivor" }]);
      expect(database.prepare("SELECT * FROM person_photos").all()).toEqual([{ person_id: "survivor", attachment_id: "shared-photo" }]);
      expect(database.prepare("SELECT * FROM members ORDER BY email").all()).toEqual([
        { email: "claimed@example.com", person_id: null, updated_at: "2026-08-30T12:00:00.000Z" },
        { email: "survivor@example.com", person_id: "survivor", updated_at: "earlier" },
      ]);
      expect(database.prepare("SELECT id FROM stories").all()).toEqual([{ id: "story-1" }]);
      expect(database.prepare("SELECT id FROM attachments ORDER BY id").all()).toEqual([{ id: "private-evidence" }, { id: "shared-photo" }]);
      expect(database.prepare("SELECT * FROM story_attachments").all()).toEqual([{ story_id: "story-1", attachment_id: "private-evidence" }]);
      expect(database.prepare("SELECT id, status, answer_note, answered_by, answered_at FROM open_questions ORDER BY id").all()).toEqual([
        {
          id: "depends-on-deleted", status: "denied", answer_note: "Closed because a referenced person was removed.",
          answered_by: "editor@example.com", answered_at: "2026-08-30T12:00:00.000Z",
        },
        { id: "historical", status: "confirmed", answer_note: "Kept for history", answered_by: "member@example.com", answered_at: "earlier" },
        { id: "similar-id", status: "open", answer_note: null, answered_by: null, answered_at: null },
      ]);
    } finally {
      database.close();
    }
  });
});
