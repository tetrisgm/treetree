import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE people (id TEXT PRIMARY KEY, photo_attachment_id TEXT);
  CREATE TABLE relationships (id TEXT PRIMARY KEY, from_person_id TEXT NOT NULL, to_person_id TEXT NOT NULL, type TEXT NOT NULL);
  CREATE TABLE stories (id TEXT PRIMARY KEY);
  CREATE TABLE story_people (story_id TEXT NOT NULL, person_id TEXT NOT NULL);
  CREATE TABLE attachments (id TEXT PRIMARY KEY);
  CREATE TABLE story_attachments (story_id TEXT NOT NULL, attachment_id TEXT NOT NULL);
  CREATE TABLE person_comments (id TEXT PRIMARY KEY, person_id TEXT NOT NULL);
  CREATE TABLE person_photos (person_id TEXT NOT NULL, attachment_id TEXT NOT NULL);
  CREATE TABLE members (email TEXT PRIMARY KEY, person_id TEXT);
  CREATE TABLE member_links (email TEXT PRIMARY KEY, member_email TEXT NOT NULL);
  CREATE TABLE document_queue (id TEXT PRIMARY KEY, attachment_id TEXT NOT NULL);
`;

const CLEAN_FIXTURE = `
  INSERT INTO attachments VALUES ('photo-1');
  INSERT INTO people VALUES
    ('grandparent', NULL), ('parent', NULL), ('child', 'photo-1'), ('spouse', NULL);
  INSERT INTO relationships VALUES
    ('rel-grandparent', 'grandparent', 'parent', 'parent'),
    ('rel-parent', 'parent', 'child', 'parent'),
    ('rel-spouse', 'child', 'spouse', 'spouse');
  INSERT INTO stories VALUES ('story-1');
  INSERT INTO story_people VALUES ('story-1', 'child');
  INSERT INTO story_attachments VALUES ('story-1', 'photo-1');
  INSERT INTO person_comments VALUES ('comment-1', 'child');
  INSERT INTO person_photos VALUES ('child', 'photo-1');
  INSERT INTO members VALUES ('member@example.com', 'child');
  INSERT INTO member_links VALUES ('alias@example.com', 'member@example.com');
  INSERT INTO document_queue VALUES ('document-1', 'photo-1');
`;

const BAD_FIXTURE = `
  INSERT INTO people VALUES
    ('parent-a', NULL), ('parent-b', NULL), ('parent-c', NULL), ('over-parented', 'missing-portrait'),
    ('cycle-a', NULL), ('cycle-b', NULL), ('self', NULL);
  INSERT INTO relationships VALUES
    ('rel-orphan', 'missing-person', 'child', 'parent'),
    ('rel-self', 'self', 'self', 'parent'),
    ('rel-spouse-forward', 'parent-a', 'parent-b', 'spouse'),
    ('rel-spouse-reverse', 'parent-b', 'parent-a', 'spouse'),
    ('rel-parent-a', 'parent-a', 'over-parented', 'parent'),
    ('rel-parent-b', 'parent-b', 'over-parented', 'parent'),
    ('rel-parent-c', 'parent-c', 'over-parented', 'parent'),
    ('rel-cycle-a', 'cycle-a', 'cycle-b', 'parent'),
    ('rel-cycle-b', 'cycle-b', 'cycle-a', 'parent');
  INSERT INTO story_people VALUES ('missing-story', 'missing-person');
  INSERT INTO person_photos VALUES ('missing-person', 'missing-attachment');
  INSERT INTO person_comments VALUES ('comment-orphan', 'missing-person');
  INSERT INTO story_attachments VALUES ('missing-story', 'missing-attachment');
  INSERT INTO members VALUES ('orphan-member@example.com', 'missing-person');
  INSERT INTO member_links VALUES ('orphan-alias@example.com', 'missing-member@example.com');
  INSERT INTO document_queue VALUES ('document-orphan', 'missing-attachment');
`;

export function integrityFixture(kind: "clean" | "bad"): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(SCHEMA);
  database.exec(CLEAN_FIXTURE);
  if (kind === "bad") database.exec(BAD_FIXTURE);
  return database;
}
