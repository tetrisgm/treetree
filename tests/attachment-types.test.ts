import { describe, expect, it } from "vitest";
import { isPublicRasterContentType, safeAttachmentContentType, sniffRasterContentType } from "../lib/attachment-types";

const ascii = (value: string) => new TextEncoder().encode(value);

describe("attachment content types", () => {
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [ascii("GIF89a"), "image/gif"],
    [ascii("RIFF0000WEBP"), "image/webp"],
  ])("recognizes a public raster signature", (bytes, expected) => {
    expect(sniffRasterContentType(bytes)).toBe(expected);
  });

  it("uses the bytes rather than a conflicting client label", () => {
    expect(safeAttachmentContentType(new Uint8Array([0xff, 0xd8, 0xff]), "image/png")).toBe("image/jpeg");
  });

  it("does not promote SVG or spoofed files to public photographs", () => {
    expect(safeAttachmentContentType(ascii("<svg><script /></svg>"), "image/svg+xml")).toBe("application/octet-stream");
    expect(safeAttachmentContentType(ascii("<svg />"), "image/png")).toBe("application/octet-stream");
  });

  it("keeps a non-image evidence type", () => {
    expect(safeAttachmentContentType(ascii("%PDF"), "APPLICATION/PDF; charset=binary")).toBe("application/pdf");
  });

  it("publishes only the byte-validated raster type set", () => {
    expect(isPublicRasterContentType("image/jpeg")).toBe(true);
    expect(isPublicRasterContentType("image/webp; charset=binary")).toBe(true);
    expect(isPublicRasterContentType("image/svg+xml")).toBe(false);
    expect(isPublicRasterContentType("application/octet-stream")).toBe(false);
  });
});
