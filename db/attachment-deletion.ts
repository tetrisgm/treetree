/**
 * Every live database reference to an attachment, followed by a durable R2
 * deletion intent. D1 can commit this plan atomically; R2 cannot participate
 * in that transaction, so the queued object key is removed only after R2
 * confirms deletion. Retrying an R2 delete is safe and idempotent.
 *
 * change_log is deliberately absent: it is historical audit data, not a live
 * relation. Open questions keep their text and answers, but lose a live image
 * link that would otherwise point at the deleted attachment.
 */
export const ATTACHMENT_DELETION_QUERIES = [
  {
    sql: "UPDATE people SET photo_attachment_id = NULL, updated_at = ? WHERE photo_attachment_id = ?",
    values: ({ attachmentId, deletedAt }: AttachmentDeletionContext) => [deletedAt, attachmentId],
  },
  { sql: "DELETE FROM person_photos WHERE attachment_id = ?", values: ({ attachmentId }: AttachmentDeletionContext) => [attachmentId] },
  { sql: "DELETE FROM story_attachments WHERE attachment_id = ?", values: ({ attachmentId }: AttachmentDeletionContext) => [attachmentId] },
  { sql: "DELETE FROM document_queue WHERE attachment_id = ?", values: ({ attachmentId }: AttachmentDeletionContext) => [attachmentId] },
  {
    sql: `UPDATE open_questions SET proposal_json = json_remove(proposal_json, '$.imageId')
      WHERE status = 'open' AND proposal_json IS NOT NULL
        AND json_extract(CASE WHEN json_valid(proposal_json) THEN proposal_json END, '$.imageId') = ?`,
    values: ({ attachmentId }: AttachmentDeletionContext) => [attachmentId],
  },
  { sql: "DELETE FROM attachments WHERE id = ?", values: ({ attachmentId }: AttachmentDeletionContext) => [attachmentId] },
  {
    // Legacy databases may contain two metadata rows for one object key. The
    // physical object survives until the last metadata row is removed.
    sql: `INSERT OR IGNORE INTO object_deletion_queue (object_key, queued_at)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM attachments WHERE object_key = ?)`,
    values: ({ objectKey, deletedAt }: AttachmentDeletionContext) => [objectKey, deletedAt, objectKey],
  },
] as const;

export type AttachmentDeletionContext = { attachmentId: string; objectKey: string; deletedAt: string };
type BindableStatement<T> = { bind(...values: string[]): T };
type StatementDatabase<T> = { prepare(sql: string): BindableStatement<T> };

export function prepareAttachmentDeletion<T>(database: StatementDatabase<T>, context: AttachmentDeletionContext): T[] {
  return ATTACHMENT_DELETION_QUERIES.map(({ sql, values }) => database.prepare(sql).bind(...values(context)));
}

const UNREFERENCED_ATTACHMENT_COMPENSATION_QUERIES = [
  {
    // A failed person-photo link may be ambiguous. Delete the freshly saved
    // metadata only if the same transaction proves nothing acquired a live
    // reference; otherwise retaining the attachment is the safe outcome.
    sql: `DELETE FROM attachments WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM people WHERE photo_attachment_id = ?)
      AND NOT EXISTS (SELECT 1 FROM person_photos WHERE attachment_id = ?)
      AND NOT EXISTS (SELECT 1 FROM story_attachments WHERE attachment_id = ?)
      AND NOT EXISTS (SELECT 1 FROM document_queue WHERE attachment_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM open_questions
        WHERE status = 'open' AND proposal_json IS NOT NULL
          AND json_extract(CASE WHEN json_valid(proposal_json) THEN proposal_json END, '$.imageId') = ?
      )`,
    values: ({ attachmentId }: AttachmentDeletionContext) => [
      attachmentId, attachmentId, attachmentId, attachmentId, attachmentId, attachmentId,
    ],
  },
  {
    sql: `INSERT OR IGNORE INTO object_deletion_queue (object_key, queued_at)
      SELECT ?, ? WHERE changes() > 0
        AND NOT EXISTS (SELECT 1 FROM attachments WHERE object_key = ?)`,
    values: ({ objectKey, deletedAt }: AttachmentDeletionContext) => [objectKey, deletedAt, objectKey],
  },
  {
    // attachPersonPhoto uses saveAttachment internally, so a compensated link
    // failure must not leave a success audit pointing at metadata we removed.
    // The attachment/live-reference predicates preserve the audit whenever the
    // failed request may actually have linked successfully.
    sql: `DELETE FROM change_log WHERE kind = 'upload_attachment'
      AND json_extract(CASE WHEN json_valid(payload_json) THEN payload_json END, '$.attachmentId') = ?
      AND NOT EXISTS (SELECT 1 FROM attachments WHERE id = ?)
      AND NOT EXISTS (SELECT 1 FROM people WHERE photo_attachment_id = ?)
      AND NOT EXISTS (SELECT 1 FROM person_photos WHERE attachment_id = ?)
      AND NOT EXISTS (SELECT 1 FROM story_attachments WHERE attachment_id = ?)
      AND NOT EXISTS (SELECT 1 FROM document_queue WHERE attachment_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM open_questions
        WHERE status = 'open' AND proposal_json IS NOT NULL
          AND json_extract(CASE WHEN json_valid(proposal_json) THEN proposal_json END, '$.imageId') = ?
      )`,
    values: ({ attachmentId }: AttachmentDeletionContext) => [
      attachmentId, attachmentId, attachmentId, attachmentId, attachmentId, attachmentId, attachmentId,
    ],
  },
] as const;

export function prepareUnreferencedAttachmentCompensation<T>(
  database: StatementDatabase<T>,
  context: AttachmentDeletionContext,
): T[] {
  return UNREFERENCED_ATTACHMENT_COMPENSATION_QUERIES.map(({ sql, values }) =>
    database.prepare(sql).bind(...values(context)));
}

type ObjectDeletionDependencies = {
  deleteObject: (objectKey: string) => Promise<void>;
  clearQueuedObject: (objectKey: string) => Promise<void>;
};

/** The queue row survives either failure, so the whole operation can be
 * retried without reconstructing metadata or relational links. */
export async function finalizeQueuedObjectDeletion(
  objectKey: string,
  dependencies: ObjectDeletionDependencies,
): Promise<void> {
  await dependencies.deleteObject(objectKey);
  await dependencies.clearQueuedObject(objectKey);
}

type AttachmentMetadataDependencies = {
  persistMetadata: () => Promise<void>;
  metadataExists: () => Promise<boolean>;
  deleteObject: (objectKey: string) => Promise<void>;
  queueObjectDeletion: (objectKey: string) => Promise<void>;
  reportAmbiguousPersistence?: (details: {
    objectKey: string;
    verificationError?: unknown;
  }) => void;
  reportDeferredCleanup?: (details: {
    objectKey: string;
    deleteError: unknown;
    queueError?: unknown;
  }) => void;
};

/** R2 is written before D1 so failed metadata must not leave an invisible
 * object behind. Prefer immediate compensation; if R2 is unavailable, retain
 * a durable D1 intent for the same idempotent deletion path used elsewhere. */
export async function persistAttachmentMetadataWithCompensation(
  objectKey: string,
  dependencies: AttachmentMetadataDependencies,
): Promise<void> {
  try {
    await dependencies.persistMetadata();
  } catch (metadataError) {
    // A transport failure can be ambiguous even though a rejected D1 batch is
    // normally rolled back. Never delete an object that may have committed
    // metadata; a possible orphan is safer than a live row with missing R2.
    let metadataStillExists: boolean;
    try {
      metadataStillExists = await dependencies.metadataExists();
    } catch (verificationError) {
      try {
        dependencies.reportAmbiguousPersistence?.({ objectKey, verificationError });
      } catch {
        // Observability must never hide the metadata failure callers need.
      }
      throw metadataError;
    }
    if (metadataStillExists) {
      try {
        dependencies.reportAmbiguousPersistence?.({ objectKey });
      } catch {
        // Observability must never hide the metadata failure callers need.
      }
      throw metadataError;
    }
    try {
      await dependencies.deleteObject(objectKey);
    } catch (deleteError) {
      let queueError: unknown;
      try {
        await dependencies.queueObjectDeletion(objectKey);
      } catch (error) {
        queueError = error;
      }
      try {
        dependencies.reportDeferredCleanup?.({ objectKey, deleteError, queueError });
      } catch {
        // Observability must never hide the metadata failure callers need.
      }
    }
    throw metadataError;
  }
}

export const OBJECT_DELETION_RETRY_BATCH_SIZE = 10;

type ObjectDeletionBatchRetryDependencies = {
  markAttempts: (objectKeys: readonly string[]) => Promise<void>;
  deleteObjects: (objectKeys: readonly string[]) => Promise<void>;
  clearQueuedObjects: (objectKeys: readonly string[]) => Promise<void>;
  reportFailure: (objectKeys: readonly string[], error: unknown) => void;
};

/** Rotate selected rows before touching R2 so one failing oldest batch cannot
 * monopolize every future retry. R2's multi-delete and the two D1 batches use
 * one outgoing connection at a time, well below the six-connection ceiling. */
export async function retryQueuedObjectDeletionBatch(
  objectKeys: readonly string[],
  dependencies: ObjectDeletionBatchRetryDependencies,
): Promise<void> {
  const batch = objectKeys.slice(0, OBJECT_DELETION_RETRY_BATCH_SIZE);
  if (!batch.length) return;
  await dependencies.markAttempts(batch);
  try {
    await dependencies.deleteObjects(batch);
  } catch (error) {
    dependencies.reportFailure(batch, error);
    return;
  }
  await dependencies.clearQueuedObjects(batch);
}

/** The direct cloudflare:workers waitUntil import is available in production,
 * while unit tests and non-Worker callers may not provide an invocation
 * context. If registration fails, explicitly await the already-started work
 * rather than leaving a floating cleanup promise. */
export async function deferObjectDeletionRetries(
  work: Promise<void>,
  defer: (promise: Promise<void>) => void,
  reportDeferFailure: (error: unknown) => void,
): Promise<"deferred" | "awaited"> {
  try {
    defer(work);
    return "deferred";
  } catch (error) {
    try {
      reportDeferFailure(error);
    } catch {
      // The fallback work still must not float if observability fails.
    }
    await work;
    return "awaited";
  }
}
