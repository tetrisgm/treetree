const PUBLIC_RASTER_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const matches = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

/** Identify the raster formats the public photo route can safely render. */
export function sniffRasterContentType(bytes: Uint8Array): string | null {
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (matches(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || matches(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return "image/gif";
  if (matches(bytes, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

const normalized = (value: string) => value.split(";", 1)[0].trim().toLowerCase();

/**
 * Never promote a client-declared image to a public photograph without a
 * matching raster signature. Other evidence keeps its declared MIME type and
 * remains on authenticated download routes.
 */
export function safeAttachmentContentType(bytes: Uint8Array, claimedType: string): string {
  const rasterType = sniffRasterContentType(bytes);
  if (rasterType) return rasterType;
  const claimed = normalized(claimedType);
  return claimed && !claimed.startsWith("image/") ? claimed : "application/octet-stream";
}

export function isPublicRasterContentType(contentType: string): boolean {
  return PUBLIC_RASTER_TYPES.has(normalized(contentType));
}
