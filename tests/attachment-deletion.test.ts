import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  deferObjectDeletionRetries,
  finalizeQueuedObjectDeletion,
  OBJECT_DELETION_RETRY_BATCH_SIZE,
  persistAttachmentMetadataWithCompensation,
  prepareAttachmentDeletion,
  prepareUnreferencedAttachmentCompensation,
  retryQueuedObjectDeletionBatch,
} from "../db/attachment-deletion";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE people (id TEXT PRIMARY KEY, photo_attachment_id TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, object_key TEXT NOT NULL);
    CREATE TABLE stories (id TEXT PRIMARY KEY);
    CREATE TABLE story_attachments (story_id TEXT NOT NULL, attachment_id TEXT NOT NULL);
    CREATE TABLE person_photos (person_id TEXT NOT NULL, attachment_id TEXT NOT NULL);
    CREATE TABLE document_queue (id TEXT PRIMARY KEY, attachment_id TEXT NOT NULL);
    CREATE TABLE open_questions (id TEXT PRIMARY KEY, proposal_json TEXT, status TEXT NOT NULL);
    CREATE TABLE object_deletion_queue (object_key TEXT PRIMARY KEY, queued_at TEXT NOT NULL);
    CREATE TABLE change_log (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL);

    INSERT INTO attachments VALUES ('deleted-photo', 'evidence/deleted-photo'), ('kept-photo', 'evidence/kept-photo');
    INSERT INTO people VALUES ('portrait-owner', 'deleted-photo', 'earlier'), ('other-person', 'kept-photo', 'earlier');
    INSERT INTO stories VALUES ('story-1');
    INSERT INTO story_attachments VALUES ('story-1', 'deleted-photo'), ('story-1', 'kept-photo');
    INSERT INTO person_photos VALUES ('portrait-owner', 'deleted-photo'), ('other-person', 'deleted-photo'), ('other-person', 'kept-photo');
    INSERT INTO document_queue VALUES ('deleted-document', 'deleted-photo'), ('kept-document', 'kept-photo');
    INSERT INTO open_questions VALUES
      ('active-image', '{"imageId":"deleted-photo","choices":[]}', 'open'),
      ('active-other-image', '{"imageId":"kept-photo"}', 'open'),
      ('historical-image', '{"imageId":"deleted-photo"}', 'confirmed'),
      ('legacy-invalid-json', 'not-json', 'open');
  `);
  return database;
}

function deleteAttachment(database: DatabaseSync) {
  database.exec("BEGIN");
  try {
    const statements = prepareAttachmentDeletion({
      prepare(sql: string) {
        return {
          bind(...values: string[]) {
            return () => database.prepare(sql).run(...values);
          },
        };
      },
    }, {
      attachmentId: "deleted-photo",
      objectKey: "evidence/deleted-photo",
      deletedAt: "2026-08-30T12:00:00.000Z",
    });
    for (const run of statements) run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function compensateUnreferencedAttachment(database: DatabaseSync, attachmentId: string, objectKey: string) {
  database.exec("BEGIN");
  try {
    const statements = prepareUnreferencedAttachmentCompensation({
      prepare(sql: string) {
        return {
          bind(...values: string[]) {
            return () => database.prepare(sql).run(...values);
          },
        };
      },
    }, { attachmentId, objectKey, deletedAt: "2026-08-30T12:00:00.000Z" });
    const results = statements.map((run) => run());
    database.exec("COMMIT");
    return results;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

describe("complete attachment deletion", () => {
  it("atomically removes every live reference and queues the R2 object", () => {
    const database = fixture();
    try {
      deleteAttachment(database);

      expect(database.prepare("SELECT * FROM attachments").all()).toEqual([
        { id: "kept-photo", object_key: "evidence/kept-photo" },
      ]);
      expect(database.prepare("SELECT * FROM people ORDER BY id").all()).toEqual([
        { id: "other-person", photo_attachment_id: "kept-photo", updated_at: "earlier" },
        { id: "portrait-owner", photo_attachment_id: null, updated_at: "2026-08-30T12:00:00.000Z" },
      ]);
      expect(database.prepare("SELECT * FROM person_photos").all()).toEqual([
        { person_id: "other-person", attachment_id: "kept-photo" },
      ]);
      expect(database.prepare("SELECT * FROM story_attachments").all()).toEqual([
        { story_id: "story-1", attachment_id: "kept-photo" },
      ]);
      expect(database.prepare("SELECT * FROM document_queue").all()).toEqual([
        { id: "kept-document", attachment_id: "kept-photo" },
      ]);
      expect(database.prepare("SELECT id, proposal_json FROM open_questions ORDER BY id").all()).toEqual([
        { id: "active-image", proposal_json: '{"choices":[]}' },
        { id: "active-other-image", proposal_json: '{"imageId":"kept-photo"}' },
        { id: "historical-image", proposal_json: '{"imageId":"deleted-photo"}' },
        { id: "legacy-invalid-json", proposal_json: "not-json" },
      ]);
      expect(database.prepare("SELECT * FROM object_deletion_queue").all()).toEqual([
        { object_key: "evidence/deleted-photo", queued_at: "2026-08-30T12:00:00.000Z" },
      ]);
    } finally {
      database.close();
    }
  });

  it("does not queue a shared legacy object until its last metadata row is deleted", () => {
    const database = fixture();
    try {
      database.prepare("INSERT INTO attachments VALUES (?, ?)").run("shared-metadata", "evidence/deleted-photo");
      deleteAttachment(database);
      expect(database.prepare("SELECT id FROM attachments WHERE object_key = ?").all("evidence/deleted-photo"))
        .toEqual([{ id: "shared-metadata" }]);
      expect(database.prepare("SELECT * FROM object_deletion_queue").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("queued R2 deletion", () => {
  it("clears the durable intent only after R2 confirms deletion", async () => {
    const order: string[] = [];
    await finalizeQueuedObjectDeletion("evidence/photo", {
      deleteObject: vi.fn(async (key) => { order.push(`r2:${key}`); }),
      clearQueuedObject: vi.fn(async (key) => { order.push(`d1:${key}`); }),
    });
    expect(order).toEqual(["r2:evidence/photo", "d1:evidence/photo"]);
  });

  it("retains the durable intent when R2 deletion fails", async () => {
    const clearQueuedObject = vi.fn(async () => undefined);
    await expect(finalizeQueuedObjectDeletion("evidence/photo", {
      deleteObject: vi.fn(async () => { throw new Error("R2 unavailable"); }),
      clearQueuedObject,
    })).rejects.toThrow("R2 unavailable");
    expect(clearQueuedObject).not.toHaveBeenCalled();
  });

  it("retains a retryable intent when clearing it fails after R2 deletion", async () => {
    const deleteObject = vi.fn(async () => undefined);
    await expect(finalizeQueuedObjectDeletion("evidence/photo", {
      deleteObject,
      clearQueuedObject: vi.fn(async () => { throw new Error("D1 unavailable"); }),
    })).rejects.toThrow("D1 unavailable");
    expect(deleteObject).toHaveBeenCalledWith("evidence/photo");
  });
});

describe("failed person-photo link compensation", () => {
  it("queues only a freshly saved attachment that acquired no live reference", () => {
    const database = fixture();
    try {
      database.prepare("INSERT INTO attachments VALUES (?, ?)").run("unlinked", "evidence/unlinked");
      database.prepare("INSERT INTO change_log VALUES (?, ?, ?)")
        .run("unlinked-upload", "upload_attachment", '{"attachmentId":"unlinked"}');
      const [deleted] = compensateUnreferencedAttachment(database, "unlinked", "evidence/unlinked");
      expect(deleted.changes).toBe(1);
      expect(database.prepare("SELECT id FROM attachments WHERE id = 'unlinked'").get()).toBeUndefined();
      expect(database.prepare("SELECT * FROM object_deletion_queue WHERE object_key = 'evidence/unlinked'").get())
        .toEqual({ object_key: "evidence/unlinked", queued_at: "2026-08-30T12:00:00.000Z" });
      expect(database.prepare("SELECT id FROM change_log WHERE id = 'unlinked-upload'").get()).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("preserves metadata when an ambiguous link acquired a live reference", () => {
    const database = fixture();
    try {
      database.prepare("INSERT INTO attachments VALUES (?, ?)").run("possibly-linked", "evidence/possibly-linked");
      database.prepare("INSERT INTO change_log VALUES (?, ?, ?)")
        .run("possibly-linked-upload", "upload_attachment", '{"attachmentId":"possibly-linked"}');
      database.prepare("INSERT INTO person_photos VALUES (?, ?)").run("other-person", "possibly-linked");
      const [deleted] = compensateUnreferencedAttachment(database, "possibly-linked", "evidence/possibly-linked");
      expect(deleted.changes).toBe(0);
      expect(database.prepare("SELECT id FROM attachments WHERE id = 'possibly-linked'").get())
        .toEqual({ id: "possibly-linked" });
      expect(database.prepare("SELECT * FROM object_deletion_queue WHERE object_key = 'evidence/possibly-linked'").get())
        .toBeUndefined();
      expect(database.prepare("SELECT id FROM change_log WHERE id = 'possibly-linked-upload'").get())
        .toEqual({ id: "possibly-linked-upload" });
    } finally {
      database.close();
    }
  });
});

describe("failed attachment save compensation", () => {
  it("does nothing after metadata commits", async () => {
    const deleteObject = vi.fn(async () => undefined);
    const metadataExists = vi.fn(async () => false);
    await persistAttachmentMetadataWithCompensation("evidence/photo", {
      persistMetadata: vi.fn(async () => undefined),
      metadataExists,
      deleteObject,
      queueObjectDeletion: vi.fn(async () => undefined),
    });
    expect(metadataExists).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes a confirmed-untracked R2 object and preserves the D1 error", async () => {
    const metadataError = new Error("D1 metadata failed");
    const deleteObject = vi.fn(async () => undefined);
    const attempt = persistAttachmentMetadataWithCompensation("evidence/photo", {
      persistMetadata: vi.fn(async () => { throw metadataError; }),
      metadataExists: vi.fn(async () => false),
      deleteObject,
      queueObjectDeletion: vi.fn(async () => undefined),
    });
    await expect(attempt).rejects.toBe(metadataError);
    expect(deleteObject).toHaveBeenCalledWith("evidence/photo");
  });

  it("preserves R2 when rejected D1 persistence may have committed", async () => {
    const metadataError = new Error("ambiguous D1 failure");
    const deleteObject = vi.fn(async () => undefined);
    const reportAmbiguousPersistence = vi.fn();
    await expect(persistAttachmentMetadataWithCompensation("evidence/photo", {
      persistMetadata: vi.fn(async () => { throw metadataError; }),
      metadataExists: vi.fn(async () => true),
      deleteObject,
      queueObjectDeletion: vi.fn(async () => undefined),
      reportAmbiguousPersistence,
    })).rejects.toBe(metadataError);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(reportAmbiguousPersistence).toHaveBeenCalledWith({ objectKey: "evidence/photo" });
  });

  it("queues compensation when R2 deletion fails without masking the D1 error", async () => {
    const metadataError = new Error("D1 metadata failed");
    const deleteError = new Error("R2 unavailable");
    const queueObjectDeletion = vi.fn(async () => undefined);
    const reportDeferredCleanup = vi.fn();
    await expect(persistAttachmentMetadataWithCompensation("evidence/photo", {
      persistMetadata: vi.fn(async () => { throw metadataError; }),
      metadataExists: vi.fn(async () => false),
      deleteObject: vi.fn(async () => { throw deleteError; }),
      queueObjectDeletion,
      reportDeferredCleanup,
    })).rejects.toBe(metadataError);
    expect(queueObjectDeletion).toHaveBeenCalledWith("evidence/photo");
    expect(reportDeferredCleanup).toHaveBeenCalledWith({
      objectKey: "evidence/photo",
      deleteError,
      queueError: undefined,
    });
  });
});

describe("bounded background deletion retries", () => {
  it("rotates then bulk-deletes one bounded batch before clearing D1", async () => {
    const order: string[] = [];
    const keys = Array.from({ length: OBJECT_DELETION_RETRY_BATCH_SIZE + 2 }, (_, index) => `evidence/${index}`);
    await retryQueuedObjectDeletionBatch(keys, {
      markAttempts: vi.fn(async (batch) => { order.push(`mark:${batch.length}`); }),
      deleteObjects: vi.fn(async (batch) => { order.push(`r2:${batch.length}`); }),
      clearQueuedObjects: vi.fn(async (batch) => { order.push(`d1:${batch.length}`); }),
      reportFailure: vi.fn(),
    });
    expect(order).toEqual([
      `mark:${OBJECT_DELETION_RETRY_BATCH_SIZE}`,
      `r2:${OBJECT_DELETION_RETRY_BATCH_SIZE}`,
      `d1:${OBJECT_DELETION_RETRY_BATCH_SIZE}`,
    ]);
  });

  it("retains all queue rows after a bulk R2 failure", async () => {
    const clearQueuedObjects = vi.fn(async () => undefined);
    const reportFailure = vi.fn();
    await retryQueuedObjectDeletionBatch(["evidence/one", "evidence/two"], {
      markAttempts: vi.fn(async () => undefined),
      deleteObjects: vi.fn(async () => { throw new Error("R2 unavailable"); }),
      clearQueuedObjects,
      reportFailure,
    });
    expect(clearQueuedObjects).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledOnce();
  });

  it("awaits the retry when waitUntil registration is unavailable", async () => {
    const order: string[] = [];
    const work = Promise.resolve().then(() => { order.push("work"); });
    await expect(deferObjectDeletionRetries(work, () => {
      throw new Error("No Worker invocation context");
    }, (error) => { order.push(`fallback:${error instanceof Error ? error.message : String(error)}`); }))
      .resolves.toBe("awaited");
    expect(order).toEqual(["fallback:No Worker invocation context", "work"]);
  });

  it("registers supported cleanup without blocking on it", async () => {
    let finish!: () => void;
    const work = new Promise<void>((resolve) => { finish = resolve; });
    const defer = vi.fn();
    await expect(deferObjectDeletionRetries(work, defer, vi.fn())).resolves.toBe("deferred");
    expect(defer).toHaveBeenCalledWith(work);
    finish();
    await work;
  });
});
