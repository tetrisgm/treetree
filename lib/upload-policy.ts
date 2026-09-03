export const MAX_UPLOAD_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 256;
export const MAX_MULTIPART_BYTES = 26 * 1024 * 1024;
export const MAX_UPLOAD_MANIFEST_CHARS = 64_000;

export type UploadPolicyError = "too_many_files" | "file_too_large" | "files_too_large";

export function validateUploadBatch(files: readonly { size: number }[]): UploadPolicyError | null {
  if (files.length > MAX_UPLOAD_FILES) return "too_many_files";
  if (files.some((file) => file.size > MAX_UPLOAD_FILE_BYTES)) return "file_too_large";
  if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES) return "files_too_large";
  return null;
}

export function requestExceedsUploadEnvelope(headers: Headers): boolean {
  const value = headers.get("content-length");
  if (!value) return false;
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > MAX_MULTIPART_BYTES;
}

const USEFUL_ARCHIVE_FILE = /\.(?:csv|css|docx?|gif|ged|html?|jpe?g|js|json|md|pdf|png|rtf|txt|webp|xlsx?|xml|zip)$/i;

/** Keep recursive folder uploads focused on material the archivist can read. */
export function isUsefulArchivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const filename = segments.at(-1) ?? "";
  if (segments.includes("__MACOSX") || filename === ".DS_Store" || filename.startsWith("._")) return false;
  return USEFUL_ARCHIVE_FILE.test(filename);
}

type SelectedFile = { name: string; size: number; lastModified: number; webkitRelativePath?: string };

export function selectedFilePath(file: SelectedFile): string {
  return file.webkitRelativePath || file.name;
}

export function selectedFileKey(file: SelectedFile): string {
  return `${selectedFilePath(file)}:${file.size}:${file.lastModified}`;
}
