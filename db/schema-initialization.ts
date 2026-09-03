export type SchemaColumnOperations = {
  listColumns: () => Promise<ReadonlySet<string>>;
  addColumn: (column: string) => Promise<void>;
};

/** Add compatibility columns without hiding real migration failures.
 *
 * A second Worker isolate can add a column after our initial schema read. In
 * that case its duplicate-column error is safe only when a fresh read proves
 * the required column now exists. Every other error remains fatal.
 */
export async function ensureColumns(
  requiredColumns: readonly string[],
  operations: SchemaColumnOperations,
) {
  let existingColumns = await operations.listColumns();
  for (const column of requiredColumns) {
    if (existingColumns.has(column)) continue;

    try {
      await operations.addColumn(column);
      existingColumns = new Set([...existingColumns, column]);
    } catch (error) {
      existingColumns = await operations.listColumns();
      if (!existingColumns.has(column)) throw error;
    }
  }
}

/** Share initialization across concurrent requests and cache only success. */
export function createSingleFlightInitializer(initialize: () => Promise<void>) {
  let initialized = false;
  let inFlight: Promise<void> | undefined;

  return (): Promise<void> => {
    if (initialized) return Promise.resolve();
    if (!inFlight) {
      inFlight = Promise.resolve()
        .then(initialize)
        .then(() => { initialized = true; })
        .catch((error) => {
          // Schema setup runs before almost every data-backed route. Without
          // this boundary a D1 failure is reduced to an empty 500 response,
          // leaving a production outage invisible in the Worker tail.
          console.error("schema_initialization_failed", error);
          throw error;
        })
        .finally(() => { inFlight = undefined; });
    }
    return inFlight;
  };
}
