import { describe, expect, it } from "vitest";
import {
  MAX_MULTIPART_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_MANIFEST_CHARS,
  MAX_UPLOAD_TOTAL_BYTES,
  isUsefulArchivePath,
  requestExceedsUploadEnvelope,
  selectedFileKey,
  validateUploadBatch,
} from "../lib/upload-policy";

describe("upload policy", () => {
  it("accepts the known Golestani family ZIP", () => {
    expect(validateUploadBatch([{ size: 11_665_604 }])).toBeNull();
    expect(MAX_UPLOAD_MANIFEST_CHARS).toBeGreaterThan(26_347);
  });

  it("enforces file, aggregate, and count boundaries", () => {
    const halfOfAggregateLimit = MAX_UPLOAD_TOTAL_BYTES / 2;
    expect(validateUploadBatch([{ size: MAX_UPLOAD_FILE_BYTES }])).toBeNull();
    expect(validateUploadBatch([{ size: MAX_UPLOAD_FILE_BYTES + 1 }])).toBe("file_too_large");
    expect(validateUploadBatch([{ size: halfOfAggregateLimit }, { size: halfOfAggregateLimit }])).toBeNull();
    expect(validateUploadBatch([{ size: 13 * 1024 * 1024 }, { size: 12 * 1024 * 1024 }])).toBe("files_too_large");
    expect(validateUploadBatch(Array.from({ length: MAX_UPLOAD_FILES }, () => ({ size: 1 })))).toBeNull();
    expect(validateUploadBatch(Array.from({ length: MAX_UPLOAD_FILES + 1 }, () => ({ size: 1 })))).toBe("too_many_files");
  });

  it("rejects an oversized request before multipart parsing", () => {
    expect(requestExceedsUploadEnvelope(new Headers({ "content-length": String(MAX_MULTIPART_BYTES + 1) }))).toBe(true);
    expect(requestExceedsUploadEnvelope(new Headers({ "content-length": String(MAX_MULTIPART_BYTES) }))).toBe(false);
    expect(requestExceedsUploadEnvelope(new Headers())).toBe(false);
  });

  it("keeps useful recursive files and ignores macOS metadata", () => {
    expect(isUsefulArchivePath("Golestani/tree/person.html")).toBe(true);
    expect(isUsefulArchivePath("Golestani/photos/family.jpg")).toBe(true);
    expect(isUsefulArchivePath("Golestani/source/notes.docx")).toBe(true);
    expect(isUsefulArchivePath("__MACOSX/Golestani/._person.html")).toBe(false);
    expect(isUsefulArchivePath("Golestani/.DS_Store")).toBe(false);
    expect(isUsefulArchivePath("Golestani/program.exe")).toBe(false);
  });

  it("distinguishes equal-sized same-name files by recursive path", () => {
    const base = { name: "Ali.html", size: 100, lastModified: 1 };
    expect(selectedFileKey({ ...base, webkitRelativePath: "branch-a/Ali.html" }))
      .not.toBe(selectedFileKey({ ...base, webkitRelativePath: "branch-b/Ali.html" }));
  });
});
