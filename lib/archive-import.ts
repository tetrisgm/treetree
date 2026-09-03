import { unzipSync } from "fflate";
import { isPublicRasterContentType, safeAttachmentContentType } from "./attachment-types";

export type ArchiveEntry =
  | { path: string; bytes: Uint8Array; kind: "text" }
  | { path: string; bytes: Uint8Array; kind: "image"; contentType: string };

export type ArchiveSkipReason =
  | "unsupported"
  | "unsafe_path"
  | "macos_metadata"
  | "duplicate_path"
  | "too_many_headers"
  | "too_many_entries"
  | "entry_too_large"
  | "extracted_total_too_large"
  | "compression_ratio_too_high"
  | "unsupported_compression"
  | "invalid_image";

export type ArchiveLimits = {
  entryBytes: number;
  totalBytes: number;
  entries: number;
  headers: number;
  compressionRatio: number;
};

export type ArchiveExtractionReport = {
  entries: ArchiveEntry[];
  skipped: Array<{ path: string; reason: ArchiveSkipReason }>;
  skippedCounts: Partial<Record<ArchiveSkipReason, number>>;
  skippedTotal: number;
  truncated: boolean;
};

const DEFAULT_LIMITS: ArchiveLimits = {
  entryBytes: 4 * 1024 * 1024,
  totalBytes: 30 * 1024 * 1024,
  entries: 500,
  headers: 2_000,
  compressionRatio: 100,
};
const MAX_SKIP_SAMPLES = 100;
const SUPPORTED_ENTRY = /\.(?:html?|css|js(?:on)?|txt|md|csv|xml|ged|jpe?g|png|webp|gif)$/i;
const IMAGE_ENTRY = /\.(?:jpe?g|png|webp|gif)$/i;
const RESOURCE_SKIP_REASONS = new Set<ArchiveSkipReason>([
  "too_many_headers", "too_many_entries", "entry_too_large", "extracted_total_too_large",
  "compression_ratio_too_high", "unsupported_compression", "invalid_image", "unsafe_path", "duplicate_path",
]);

export class ArchiveImportError extends Error {
  readonly code: "invalid_zip";

  constructor(code: "invalid_zip", message: string) {
    super(message);
    this.name = "ArchiveImportError";
    this.code = code;
  }
}

function hasZipSignature(data: Uint8Array): boolean {
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) return false;
  return (data[2] === 0x03 && data[3] === 0x04)
    || (data[2] === 0x05 && data[3] === 0x06)
    || (data[2] === 0x07 && data[3] === 0x08);
}

function normalizedArchivePath(path: string): { path?: string; reason?: ArchiveSkipReason } {
  const slashPath = path.replaceAll("\\", "/");
  if (!slashPath || slashPath.includes("\0") || slashPath.startsWith("/") || /^[a-z]:\//i.test(slashPath)) return { reason: "unsafe_path" };
  const rawSegments = slashPath.split("/");
  if (rawSegments.includes("..")) return { reason: "unsafe_path" };
  const segments = rawSegments.filter((segment) => segment && segment !== ".");
  const filename = segments.at(-1) ?? "";
  if (!filename) return { reason: "unsupported" };
  if (segments.some((segment) => segment.toLowerCase() === "__macosx") || filename === ".DS_Store" || filename.startsWith("._")) {
    return { reason: "macos_metadata" };
  }
  return { path: segments.join("/") };
}

function imageType(path: string, bytes: Uint8Array): string | null {
  const extension = path.split(".").pop()?.toLowerCase();
  const claimed = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
  const detected = safeAttachmentContentType(bytes.subarray(0, 16), claimed);
  return isPublicRasterContentType(detected) ? detected : null;
}

export function extractArchive(
  data: Uint8Array,
  overrides: Partial<ArchiveLimits> = {},
): ArchiveExtractionReport {
  if (!hasZipSignature(data)) throw new ArchiveImportError("invalid_zip", "The uploaded file is not a ZIP archive.");
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  let selectedBytes = 0;
  let selectedEntries = 0;
  let scannedHeaders = 0;
  let skippedTotal = 0;
  const selectedPaths = new Map<string, string>();
  const canonicalPaths = new Set<string>();
  const skipped: ArchiveExtractionReport["skipped"] = [];
  const skippedCounts: ArchiveExtractionReport["skippedCounts"] = {};

  const recordSkip = (path: string, reason: ArchiveSkipReason) => {
    skippedTotal += 1;
    skippedCounts[reason] = (skippedCounts[reason] ?? 0) + 1;
    if (skipped.length < MAX_SKIP_SAMPLES) skipped.push({ path, reason });
  };

  const files = unzipSync(data, { filter: (entry) => {
    scannedHeaders += 1;
    if (scannedHeaders > limits.headers) { recordSkip(entry.name, "too_many_headers"); return false; }
    const normalized = normalizedArchivePath(entry.name);
    if (!normalized.path) { recordSkip(entry.name, normalized.reason ?? "unsafe_path"); return false; }
    const path = normalized.path;
    if (!SUPPORTED_ENTRY.test(path)) { recordSkip(path, "unsupported"); return false; }
    const canonical = path.toLocaleLowerCase("en-US");
    if (canonicalPaths.has(canonical)) { recordSkip(path, "duplicate_path"); return false; }
    if (entry.compression !== 0 && entry.compression !== 8) { recordSkip(path, "unsupported_compression"); return false; }
    if (entry.originalSize > limits.entryBytes) { recordSkip(path, "entry_too_large"); return false; }
    const ratio = entry.originalSize / Math.max(1, entry.size);
    if (ratio > limits.compressionRatio) { recordSkip(path, "compression_ratio_too_high"); return false; }
    if (selectedEntries >= limits.entries) { recordSkip(path, "too_many_entries"); return false; }
    if (selectedBytes + entry.originalSize > limits.totalBytes) { recordSkip(path, "extracted_total_too_large"); return false; }
    canonicalPaths.add(canonical);
    selectedPaths.set(entry.name, path);
    selectedBytes += entry.originalSize;
    selectedEntries += 1;
    return true;
  } });

  const entries: ArchiveEntry[] = [];
  for (const [originalPath, bytes] of Object.entries(files)) {
    const path = selectedPaths.get(originalPath);
    if (!path) continue;
    if (!IMAGE_ENTRY.test(path)) {
      entries.push({ path, bytes, kind: "text" });
      continue;
    }
    const contentType = imageType(path, bytes);
    if (!contentType) {
      recordSkip(path, "invalid_image");
      continue;
    }
    entries.push({ path, bytes, kind: "image", contentType });
  }

  return {
    entries,
    skipped,
    skippedCounts,
    skippedTotal,
    truncated: Object.keys(skippedCounts).some((reason) => RESOURCE_SKIP_REASONS.has(reason as ArchiveSkipReason)),
  };
}

/** Compatibility helper for callers that only need selected entries. */
export function extractArchiveEntries(data: Uint8Array, limits: Partial<ArchiveLimits> = {}): ArchiveEntry[] {
  return extractArchive(data, limits).entries;
}
