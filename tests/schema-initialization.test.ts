import { describe, expect, it, vi } from "vitest";
import { createSingleFlightInitializer, ensureColumns } from "../db/schema-initialization";

describe("schema initialization", () => {
  it("shares one initialization across concurrent callers and caches success", async () => {
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    const initialize = vi.fn(() => blocked);
    const ensureInitialized = createSingleFlightInitializer(initialize);

    const first = ensureInitialized();
    const second = ensureInitialized();

    expect(second).toBe(first);
    expect(initialize).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledTimes(1);

    finish();
    await Promise.all([first, second]);
    await ensureInitialized();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("reports and retries initialization after a failure", async () => {
    const failure = new Error("database unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const initialize = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    const ensureInitialized = createSingleFlightInitializer(initialize);

    await expect(ensureInitialized()).rejects.toBe(failure);
    expect(report).toHaveBeenCalledWith("schema_initialization_failed", failure);
    await expect(ensureInitialized()).resolves.toBeUndefined();
    expect(initialize).toHaveBeenCalledTimes(2);
    report.mockRestore();
  });

  it("adds only missing compatibility columns", async () => {
    const columns = new Set(["existing"]);
    const addColumn = vi.fn(async (column: string) => { columns.add(column); });

    await ensureColumns(["existing", "new_column"], {
      listColumns: async () => new Set(columns),
      addColumn,
    });

    expect(addColumn).toHaveBeenCalledOnce();
    expect(addColumn).toHaveBeenCalledWith("new_column");
  });

  it("accepts a concurrent add only after verifying the column exists", async () => {
    const columns = new Set<string>();
    const duplicate = new Error("duplicate column name");

    await expect(ensureColumns(["person_id"], {
      listColumns: async () => new Set(columns),
      addColumn: async (column) => {
        columns.add(column);
        throw duplicate;
      },
    })).resolves.toBeUndefined();
  });

  it("does not swallow a failed column migration", async () => {
    const failure = new Error("permission denied");

    await expect(ensureColumns(["person_id"], {
      listColumns: async () => new Set(),
      addColumn: async () => { throw failure; },
    })).rejects.toBe(failure);
  });
});
