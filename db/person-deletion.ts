/**
 * Every relational row that directly depends on a person. The archive does
 * not use foreign keys, so both human and agent deletion paths must execute
 * this complete plan before removing the person itself.
 *
 * Attachment and story records intentionally survive: they are archive
 * evidence shared independently of the person. Only their person links go.
 */
export const PERSON_DELETION_QUERIES = [
  { sql: "DELETE FROM evidence_claims WHERE (subject_type = 'person' AND subject_id = ?) OR (subject_type = 'relationship' AND subject_id IN (SELECT id FROM relationships WHERE from_person_id = ? OR to_person_id = ?))", values: ({ personId }: PersonDeletionContext) => [personId, personId, personId] },
  { sql: "DELETE FROM relationships WHERE from_person_id = ? OR to_person_id = ?", values: ({ personId }: PersonDeletionContext) => [personId, personId] },
  { sql: "DELETE FROM story_people WHERE person_id = ?", values: ({ personId }: PersonDeletionContext) => [personId] },
  { sql: "DELETE FROM person_photos WHERE person_id = ?", values: ({ personId }: PersonDeletionContext) => [personId] },
  { sql: "DELETE FROM person_comments WHERE person_id = ?", values: ({ personId }: PersonDeletionContext) => [personId] },
  { sql: "UPDATE members SET person_id = NULL, updated_at = ? WHERE person_id = ?", values: ({ personId, deletedAt }: PersonDeletionContext) => [deletedAt, personId] },
  {
    sql: `UPDATE open_questions
      SET status = 'denied', answer_note = COALESCE(answer_note, 'Closed because a referenced person was removed.'),
        answered_by = ?, answered_at = ?
      WHERE status = 'open' AND proposal_json IS NOT NULL AND instr(proposal_json, ?) > 0`,
    values: ({ personId, actorEmail, deletedAt }: PersonDeletionContext) => [actorEmail, deletedAt, JSON.stringify(personId)],
  },
  { sql: "DELETE FROM people WHERE id = ?", values: ({ personId }: PersonDeletionContext) => [personId] },
] as const;

export type PersonDeletionContext = { personId: string; actorEmail: string; deletedAt: string };
type BindableStatement<T> = { bind(...values: string[]): T };
type StatementDatabase<T> = { prepare(sql: string): BindableStatement<T> };

export function preparePersonDeletion<T>(database: StatementDatabase<T>, context: PersonDeletionContext): T[] {
  return PERSON_DELETION_QUERIES.map(({ sql, values }) => database.prepare(sql).bind(...values(context)));
}
