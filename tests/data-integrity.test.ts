import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  assertDataIntegrity,
  DataIntegrityError,
  DATA_INTEGRITY_CHECKS,
  runDataIntegrityChecks,
  type IntegrityDatabase,
} from "../lib/data-integrity";
import { integrityFixture } from "./fixtures/data-integrity";

function d1Reader(database: DatabaseSync): IntegrityDatabase {
  return {
    prepare(sql) {
      return {
        async all<T>() {
          return { results: database.prepare(sql).all() as T[] };
        },
      };
    },
  };
}

describe("raw D1 data integrity", () => {
  it("accepts a clean fixture", async () => {
    const database = integrityFixture("clean");
    try {
      const report = await assertDataIntegrity(d1Reader(database));
      expect(report).toHaveLength(DATA_INTEGRITY_CHECKS.length);
      expect(report.every((result) => result.ok && result.count === 0)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("finds deterministic violations in a bad fixture", async () => {
    const database = integrityFixture("bad");
    try {
      const report = await runDataIntegrityChecks(d1Reader(database));
      expect(Object.fromEntries(report.map(({ check, count }) => [check.id, count]))).toEqual({
        orphan_references: 12,
        self_relationships: 1,
        reverse_spouse_relationships: 1,
        too_many_parents: 1,
        parent_cycles: 2,
      });
      expect(report.find(({ check }) => check.id === "parent_cycles")?.rows).toEqual([
        { person_id: "cycle-a" },
        { person_id: "cycle-b" },
      ]);
    } finally {
      database.close();
    }
  });

  it("raises one useful assertion error containing every failed check", async () => {
    const database = integrityFixture("bad");
    try {
      await expect(assertDataIntegrity(d1Reader(database))).rejects.toMatchObject({
        name: "DataIntegrityError",
        message: expect.stringContaining("parent_cycles (2)"),
        violations: expect.arrayContaining([
          expect.objectContaining({ check: expect.objectContaining({ id: "orphan_references" }), count: 12 }),
        ]),
      });
    } finally {
      database.close();
    }
  });

  it("uses only read-only SELECT or CTE statements", () => {
    for (const check of DATA_INTEGRITY_CHECKS) {
      expect(check.sql.trim()).toMatch(/^(SELECT|WITH)\b/i);
      expect(check.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\b/i);
    }
    expect(DataIntegrityError.prototype).toBeInstanceOf(Error);
  });
});
