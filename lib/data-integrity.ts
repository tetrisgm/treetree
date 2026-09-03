/**
 * Read-only assertions for relationships and references in the raw D1 store.
 *
 * The database intentionally has no foreign keys yet. These queries make its
 * current assumptions executable without coupling the checks to Workers or to
 * the command used to reach a particular D1 database.
 */

export type IntegrityRow = Record<string, string | number | null>;

export interface IntegrityDatabase {
  prepare(query: string): {
    all<T = IntegrityRow>(): Promise<{ results: T[] }>;
  };
}

export type IntegrityCheck = {
  id: string;
  description: string;
  /** A read-only SQLite/D1 query. Every returned row is one violation. */
  sql: string;
};

export const DATA_INTEGRITY_CHECKS = [
  {
    id: "orphan_references",
    description: "links and references point at records that still exist",
    sql: `WITH orphan_references(source_table, source_id, column_name, missing_table, missing_id) AS (
      SELECT 'relationships', r.id, 'from_person_id', 'people', r.from_person_id
        FROM relationships r
        WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = r.from_person_id)
      UNION ALL
      SELECT 'relationships', r.id, 'to_person_id', 'people', r.to_person_id
        FROM relationships r
        WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = r.to_person_id)
      UNION ALL
      SELECT 'story_people', sp.story_id || ':' || sp.person_id, 'story_id', 'stories', sp.story_id
        FROM story_people sp
        WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = sp.story_id)
      UNION ALL
      SELECT 'story_people', sp.story_id || ':' || sp.person_id, 'person_id', 'people', sp.person_id
        FROM story_people sp
        WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = sp.person_id)
      UNION ALL
      SELECT 'person_photos', pp.person_id || ':' || pp.attachment_id, 'person_id', 'people', pp.person_id
        FROM person_photos pp
        WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = pp.person_id)
      UNION ALL
      SELECT 'person_photos', pp.person_id || ':' || pp.attachment_id, 'attachment_id', 'attachments', pp.attachment_id
        FROM person_photos pp
        WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.id = pp.attachment_id)
      UNION ALL
      SELECT 'person_comments', c.id, 'person_id', 'people', c.person_id
        FROM person_comments c
        WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = c.person_id)
      UNION ALL
      SELECT 'story_attachments', sa.story_id || ':' || sa.attachment_id, 'story_id', 'stories', sa.story_id
        FROM story_attachments sa
        WHERE NOT EXISTS (SELECT 1 FROM stories s WHERE s.id = sa.story_id)
      UNION ALL
      SELECT 'story_attachments', sa.story_id || ':' || sa.attachment_id, 'attachment_id', 'attachments', sa.attachment_id
        FROM story_attachments sa
        WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.id = sa.attachment_id)
      UNION ALL
      SELECT 'people', p.id, 'photo_attachment_id', 'attachments', p.photo_attachment_id
        FROM people p
        WHERE p.photo_attachment_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.id = p.photo_attachment_id)
      UNION ALL
      SELECT 'members', m.email, 'person_id', 'people', m.person_id
        FROM members m
        WHERE m.person_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM people p WHERE p.id = m.person_id)
      UNION ALL
      SELECT 'member_links', ml.email, 'member_email', 'members', ml.member_email
        FROM member_links ml
        WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.email = ml.member_email)
      UNION ALL
      SELECT 'document_queue', dq.id, 'attachment_id', 'attachments', dq.attachment_id
        FROM document_queue dq
        WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.id = dq.attachment_id)
    )
    SELECT source_table, source_id, column_name, missing_table, missing_id
      FROM orphan_references
      ORDER BY source_table, source_id, column_name, missing_table, missing_id`,
  },
  {
    id: "self_relationships",
    description: "nobody is their own parent or spouse",
    sql: `SELECT id AS relationship_id, from_person_id AS person_id, type
      FROM relationships
      WHERE from_person_id = to_person_id
      ORDER BY relationship_id`,
  },
  {
    id: "reverse_spouse_relationships",
    description: "a spouse relationship is stored in only one direction",
    sql: `SELECT a.id AS relationship_id, b.id AS reverse_relationship_id,
             a.from_person_id, a.to_person_id
      FROM relationships a
      JOIN relationships b
        ON b.type = 'spouse'
       AND b.from_person_id = a.to_person_id
       AND b.to_person_id = a.from_person_id
      WHERE a.type = 'spouse' AND a.id < b.id
      ORDER BY relationship_id, reverse_relationship_id`,
  },
  {
    id: "too_many_parents",
    description: "nobody has more than two distinct recorded parents",
    sql: `SELECT to_person_id AS person_id, COUNT(DISTINCT from_person_id) AS parent_count
      FROM relationships
      WHERE type = 'parent'
      GROUP BY to_person_id
      HAVING COUNT(DISTINCT from_person_id) > 2
      ORDER BY person_id`,
  },
  {
    id: "parent_cycles",
    description: "parent relationships form an acyclic graph",
    sql: `WITH RECURSIVE
      parent_edges(parent_id, child_id) AS (
        SELECT from_person_id, to_person_id
          FROM relationships
          WHERE type = 'parent' AND from_person_id <> to_person_id
      ),
      paths(start_id, current_id, visited) AS (
        SELECT parent_id, child_id, '|' || parent_id || '|' || child_id || '|'
          FROM parent_edges
        UNION ALL
        SELECT paths.start_id, edges.child_id, paths.visited || edges.child_id || '|'
          FROM paths
          JOIN parent_edges edges ON edges.parent_id = paths.current_id
          WHERE paths.current_id <> paths.start_id
            AND (
              edges.child_id = paths.start_id
              OR instr(paths.visited, '|' || edges.child_id || '|') = 0
            )
      )
    SELECT DISTINCT start_id AS person_id
      FROM paths
      WHERE current_id = start_id
      ORDER BY person_id`,
  },
] as const satisfies readonly IntegrityCheck[];

export type IntegrityCheckResult = {
  check: IntegrityCheck;
  rows: IntegrityRow[];
  count: number;
  ok: boolean;
};

export async function runDataIntegrityChecks(
  database: IntegrityDatabase,
  checks: readonly IntegrityCheck[] = DATA_INTEGRITY_CHECKS,
): Promise<IntegrityCheckResult[]> {
  const report: IntegrityCheckResult[] = [];
  for (const check of checks) {
    const { results } = await database.prepare(check.sql).all<IntegrityRow>();
    report.push({ check, rows: results, count: results.length, ok: results.length === 0 });
  }
  return report;
}

export class DataIntegrityError extends Error {
  readonly violations: IntegrityCheckResult[];

  constructor(violations: IntegrityCheckResult[]) {
    const summary = violations.map(({ check, count }) => `${check.id} (${count})`).join(", ");
    super(`Data integrity assertions failed: ${summary}`);
    this.name = "DataIntegrityError";
    this.violations = violations;
  }
}

export async function assertDataIntegrity(
  database: IntegrityDatabase,
  checks: readonly IntegrityCheck[] = DATA_INTEGRITY_CHECKS,
): Promise<IntegrityCheckResult[]> {
  const report = await runDataIntegrityChecks(database, checks);
  const violations = report.filter((result) => !result.ok);
  if (violations.length) throw new DataIntegrityError(violations);
  return report;
}
