import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  gender: text("gender", { enum: ["male", "female"] }),
  givenName: text("given_name"), familyName: text("family_name"),
  birthDate: text("birth_date"), deathDate: text("death_date"),
  birthPlace: text("birth_place"), deathPlace: text("death_place"), birthCity: text("birth_city"), birthCountry: text("birth_country"), deathCity: text("death_city"), deathCountry: text("death_country"), biography: text("biography"), photoAttachmentId: text("photo_attachment_id"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const relationships = sqliteTable("relationships", {
  id: text("id").primaryKey(), fromPersonId: text("from_person_id").notNull(),
  toPersonId: text("to_person_id").notNull(), type: text("type", { enum: ["parent", "spouse"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_relationship_unique").on(table.fromPersonId, table.toPersonId, table.type)]);
export const stories = sqliteTable("stories", {
  id: text("id").primaryKey(), title: text("title").notNull(), body: text("body").notNull(),
  date: text("date"), place: text("place"), createdAt: text("created_at").notNull(),
});
export const storyPeople = sqliteTable("story_people", { storyId: text("story_id").notNull(), personId: text("person_id").notNull() },
  (table) => [uniqueIndex("idx_story_people_unique").on(table.storyId, table.personId)]);
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(), objectKey: text("object_key").notNull(), filename: text("filename").notNull(),
  contentType: text("content_type").notNull(), size: integer("size").notNull(), createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull(),
});
export const objectDeletionQueue = sqliteTable("object_deletion_queue", {
  objectKey: text("object_key").primaryKey(), queuedAt: text("queued_at").notNull(),
});
export const questionAnswerClaims = sqliteTable("question_answer_claims", {
  questionId: text("question_id").primaryKey(), claimedAt: text("claimed_at").notNull(),
});
export const evidenceClaims = sqliteTable("evidence_claims", {
  id: text("id").primaryKey(),
  subjectType: text("subject_type", { enum: ["person", "relationship"] }).notNull(),
  subjectId: text("subject_id").notNull(),
  predicate: text("predicate").notNull(),
  value: text("value"),
  status: text("status", { enum: ["preferred", "disputed", "rejected"] }).notNull(),
  confidence: integer("confidence").notNull(),
  sourceType: text("source_type", { enum: ["manual", "family_assertion", "attachment", "agent", "import"] }).notNull(),
  attachmentId: text("attachment_id"), sourceLabel: text("source_label").notNull(),
  sourceLocator: text("source_locator"), sourceExcerpt: text("source_excerpt"),
  createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const mergeSnapshots = sqliteTable("merge_snapshots", {
  changeId: text("change_id").primaryKey(), sourcePersonId: text("source_person_id").notNull(),
  targetPersonId: text("target_person_id").notNull(), snapshotJson: text("snapshot_json").notNull(),
  mergedAt: text("merged_at").notNull(), restoredAt: text("restored_at"),
});
export const personDeletionSnapshots = sqliteTable("person_deletion_snapshots", {
  changeId: text("change_id").primaryKey(), personId: text("person_id").notNull(),
  snapshotJson: text("snapshot_json").notNull(), deletedAt: text("deleted_at").notNull(), restoredAt: text("restored_at"),
});
export const rateLimits = sqliteTable("rate_limits", {
  bucket: text("bucket").primaryKey(), count: integer("count").notNull(), expiresAt: text("expires_at").notNull(),
});
export const storyAttachments = sqliteTable("story_attachments", { storyId: text("story_id").notNull(), attachmentId: text("attachment_id").notNull() },
  (table) => [uniqueIndex("idx_story_attachments_unique").on(table.storyId, table.attachmentId)]);
export const changeLog = sqliteTable("change_log", {
  id: text("id").primaryKey(), actorEmail: text("actor_email").notNull(), kind: text("kind").notNull(),
  summary: text("summary").notNull(), payloadJson: text("payload_json").notNull(), createdAt: text("created_at").notNull(),
});
