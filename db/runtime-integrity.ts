/**
 * SQLite-enforced invariants for writes that can arrive concurrently.
 *
 * These are triggers rather than retrofitted foreign keys so an existing D1
 * database can install them without rebuilding tables. Existing rows are left
 * untouched; every future insert, structural update, or referenced-record
 * deletion must preserve the live graph.
 */
export const RUNTIME_INTEGRITY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS question_answer_claims (
    question_id TEXT PRIMARY KEY, claimed_at TEXT NOT NULL
  )`,

  `CREATE TRIGGER IF NOT EXISTS relationships_validate_insert
    BEFORE INSERT ON relationships
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.from_person_id)
        OR NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.to_person_id)
        THEN RAISE(ABORT, 'relationship_person_missing') END;
      SELECT CASE WHEN NEW.from_person_id = NEW.to_person_id
        THEN RAISE(ABORT, 'relationship_self_link') END;
      SELECT CASE WHEN NEW.type = 'spouse' AND EXISTS (
        SELECT 1 FROM relationships
        WHERE type = 'spouse' AND from_person_id = NEW.to_person_id AND to_person_id = NEW.from_person_id
      ) THEN RAISE(ABORT, 'relationship_reverse_spouse') END;
      SELECT CASE WHEN NEW.type = 'parent' AND (
        SELECT COUNT(DISTINCT from_person_id) FROM relationships
        WHERE type = 'parent' AND to_person_id = NEW.to_person_id
      ) >= 2 THEN RAISE(ABORT, 'relationship_too_many_parents') END;
      SELECT CASE WHEN NEW.type = 'parent' AND EXISTS (
        WITH RECURSIVE descendants(person_id) AS (
          SELECT to_person_id FROM relationships
            WHERE type = 'parent' AND from_person_id = NEW.to_person_id
          UNION
          SELECT relationship.to_person_id
            FROM relationships relationship
            JOIN descendants ON relationship.from_person_id = descendants.person_id
            WHERE relationship.type = 'parent'
        )
        SELECT 1 FROM descendants WHERE person_id = NEW.from_person_id
      ) THEN RAISE(ABORT, 'relationship_parent_cycle') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS relationships_validate_update
    BEFORE UPDATE OF from_person_id, to_person_id, type ON relationships
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.from_person_id)
        OR NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.to_person_id)
        THEN RAISE(ABORT, 'relationship_person_missing') END;
      SELECT CASE WHEN NEW.from_person_id = NEW.to_person_id
        THEN RAISE(ABORT, 'relationship_self_link') END;
      SELECT CASE WHEN NEW.type = 'spouse' AND EXISTS (
        SELECT 1 FROM relationships
        WHERE id <> OLD.id AND type = 'spouse'
          AND from_person_id = NEW.to_person_id AND to_person_id = NEW.from_person_id
      ) THEN RAISE(ABORT, 'relationship_reverse_spouse') END;
      SELECT CASE WHEN NEW.type = 'parent' AND (
        SELECT COUNT(DISTINCT from_person_id) FROM relationships
        WHERE id <> OLD.id AND type = 'parent' AND to_person_id = NEW.to_person_id
      ) >= 2 THEN RAISE(ABORT, 'relationship_too_many_parents') END;
      SELECT CASE WHEN NEW.type = 'parent' AND EXISTS (
        WITH RECURSIVE descendants(person_id) AS (
          SELECT to_person_id FROM relationships
            WHERE id <> OLD.id AND type = 'parent' AND from_person_id = NEW.to_person_id
          UNION
          SELECT relationship.to_person_id
            FROM relationships relationship
            JOIN descendants ON relationship.from_person_id = descendants.person_id
            WHERE relationship.id <> OLD.id AND relationship.type = 'parent'
        )
        SELECT 1 FROM descendants WHERE person_id = NEW.from_person_id
      ) THEN RAISE(ABORT, 'relationship_parent_cycle') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS story_people_validate_insert
    BEFORE INSERT ON story_people
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM stories WHERE id = NEW.story_id)
        THEN RAISE(ABORT, 'story_person_story_missing') END;
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id)
        THEN RAISE(ABORT, 'story_person_person_missing') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS story_people_validate_update
    BEFORE UPDATE OF story_id, person_id ON story_people
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM stories WHERE id = NEW.story_id)
        THEN RAISE(ABORT, 'story_person_story_missing') END;
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id)
        THEN RAISE(ABORT, 'story_person_person_missing') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS story_attachments_validate_insert
    BEFORE INSERT ON story_attachments
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM stories WHERE id = NEW.story_id)
        THEN RAISE(ABORT, 'story_attachment_story_missing') END;
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.attachment_id)
        THEN RAISE(ABORT, 'story_attachment_attachment_missing') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS story_attachments_validate_update
    BEFORE UPDATE OF story_id, attachment_id ON story_attachments
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM stories WHERE id = NEW.story_id)
        THEN RAISE(ABORT, 'story_attachment_story_missing') END;
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.attachment_id)
        THEN RAISE(ABORT, 'story_attachment_attachment_missing') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS person_photos_validate_insert
    BEFORE INSERT ON person_photos
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id)
        THEN RAISE(ABORT, 'person_photo_person_missing') END;
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.attachment_id)
        THEN RAISE(ABORT, 'person_photo_attachment_missing') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS person_photos_validate_update
    BEFORE UPDATE OF person_id, attachment_id ON person_photos
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id)
        THEN RAISE(ABORT, 'person_photo_person_missing') END;
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.attachment_id)
        THEN RAISE(ABORT, 'person_photo_attachment_missing') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS person_comments_validate_insert
    BEFORE INSERT ON person_comments
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id)
        THEN RAISE(ABORT, 'person_comment_person_missing') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS person_comments_validate_update
    BEFORE UPDATE OF person_id ON person_comments
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id)
        THEN RAISE(ABORT, 'person_comment_person_missing') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS members_validate_person_insert
    BEFORE INSERT ON members
    WHEN NEW.person_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id)
        THEN RAISE(ABORT, 'member_person_missing') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS members_validate_person_update
    BEFORE UPDATE OF person_id ON members
    WHEN NEW.person_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id)
        THEN RAISE(ABORT, 'member_person_missing') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS people_validate_photo_insert
    BEFORE INSERT ON people
    WHEN NEW.photo_attachment_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.photo_attachment_id)
        THEN RAISE(ABORT, 'person_portrait_attachment_missing') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS people_validate_photo_update
    BEFORE UPDATE OF photo_attachment_id ON people
    WHEN NEW.photo_attachment_id IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.photo_attachment_id)
        THEN RAISE(ABORT, 'person_portrait_attachment_missing') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS document_queue_validate_insert
    BEFORE INSERT ON document_queue
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.attachment_id)
        THEN RAISE(ABORT, 'document_attachment_missing') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS document_queue_validate_update
    BEFORE UPDATE OF attachment_id ON document_queue
    BEGIN
      SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM attachments WHERE id = NEW.attachment_id)
        THEN RAISE(ABORT, 'document_attachment_missing') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS open_questions_validate_image_insert
    BEFORE INSERT ON open_questions
    WHEN NEW.status = 'open' AND NEW.proposal_json IS NOT NULL
      AND json_type(CASE WHEN json_valid(NEW.proposal_json) THEN NEW.proposal_json END, '$.imageId') IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM attachments
          WHERE id = json_extract(CASE WHEN json_valid(NEW.proposal_json) THEN NEW.proposal_json END, '$.imageId')
      ) THEN RAISE(ABORT, 'question_image_attachment_missing') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS open_questions_validate_image_update
    BEFORE UPDATE OF proposal_json, status ON open_questions
    WHEN NEW.status = 'open' AND NEW.proposal_json IS NOT NULL
      AND json_type(CASE WHEN json_valid(NEW.proposal_json) THEN NEW.proposal_json END, '$.imageId') IS NOT NULL
    BEGIN
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM attachments
          WHERE id = json_extract(CASE WHEN json_valid(NEW.proposal_json) THEN NEW.proposal_json END, '$.imageId')
      ) THEN RAISE(ABORT, 'question_image_attachment_missing') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS attachments_validate_object_key_insert
    BEFORE INSERT ON attachments
    BEGIN
      SELECT CASE WHEN EXISTS (SELECT 1 FROM attachments WHERE object_key = NEW.object_key)
        OR EXISTS (SELECT 1 FROM object_deletion_queue WHERE object_key = NEW.object_key)
        THEN RAISE(ABORT, 'attachment_object_key_unavailable') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS attachments_validate_object_key_update
    BEFORE UPDATE OF object_key ON attachments
    BEGIN
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM attachments WHERE id <> OLD.id AND object_key = NEW.object_key
      ) OR EXISTS (SELECT 1 FROM object_deletion_queue WHERE object_key = NEW.object_key)
        THEN RAISE(ABORT, 'attachment_object_key_unavailable') END;
    END`,

  `CREATE TRIGGER IF NOT EXISTS people_restrict_delete
    BEFORE DELETE ON people
    BEGIN
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM relationships WHERE from_person_id = OLD.id OR to_person_id = OLD.id
      ) OR EXISTS (SELECT 1 FROM story_people WHERE person_id = OLD.id)
        OR EXISTS (SELECT 1 FROM person_photos WHERE person_id = OLD.id)
        OR EXISTS (SELECT 1 FROM person_comments WHERE person_id = OLD.id)
        OR EXISTS (SELECT 1 FROM members WHERE person_id = OLD.id)
        THEN RAISE(ABORT, 'person_still_referenced') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS stories_restrict_delete
    BEFORE DELETE ON stories
    BEGIN
      SELECT CASE WHEN EXISTS (SELECT 1 FROM story_people WHERE story_id = OLD.id)
        OR EXISTS (SELECT 1 FROM story_attachments WHERE story_id = OLD.id)
        THEN RAISE(ABORT, 'story_still_referenced') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS attachments_restrict_delete
    BEFORE DELETE ON attachments
    BEGIN
      SELECT CASE WHEN EXISTS (SELECT 1 FROM people WHERE photo_attachment_id = OLD.id)
        OR EXISTS (SELECT 1 FROM person_photos WHERE attachment_id = OLD.id)
        OR EXISTS (SELECT 1 FROM story_attachments WHERE attachment_id = OLD.id)
        OR EXISTS (SELECT 1 FROM document_queue WHERE attachment_id = OLD.id)
        OR EXISTS (
          SELECT 1 FROM open_questions
          WHERE status = 'open' AND proposal_json IS NOT NULL
            AND json_extract(CASE WHEN json_valid(proposal_json) THEN proposal_json END, '$.imageId') = OLD.id
        ) THEN RAISE(ABORT, 'attachment_still_referenced') END;
    END`,
] as const;

export const CLAIM_QUESTION_ANSWER_SQL =
  "INSERT INTO question_answer_claims (question_id, claimed_at) VALUES (?, ?)";
