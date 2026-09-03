import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extractArchive, extractArchiveEntries } from "../lib/archive-import";

describe("recursive archive import", () => {
  it("keeps nested family data and images while ignoring unrelated binaries", () => {
    const archive = zipSync({
      "tree/index.html": strToU8("<h1>Farhad Golestani</h1>"),
      "tree/branches/children.json": strToU8('{"children":["Roya","Kian"]}'),
      "tree/photos/farhad.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      "tree/program.exe": new Uint8Array([1, 2, 3]),
    });
    const entries = extractArchiveEntries(archive);
    expect(entries.map((entry) => entry.path)).toEqual(["tree/index.html", "tree/branches/children.json", "tree/photos/farhad.jpg"]);
    expect(entries.map((entry) => entry.kind)).toEqual(["text", "text", "image"]);
  });

  it("rejects entries that exceed the expansion budget before inflating them", () => {
    const archive = zipSync({ "large.txt": strToU8("family".repeat(100)) });
    expect(extractArchiveEntries(archive, { entryBytes: 10, totalBytes: 20, entries: 5 })).toEqual([]);
  });

  it("requires ZIP bytes instead of trusting a filename", () => {
    expect(() => extractArchiveEntries(strToU8("not a zip"))).toThrowError("not a ZIP archive");
  });

  it("rejects traversal, macOS metadata, and case-colliding paths", () => {
    const archive = zipSync({
      "tree/Ali.html": strToU8("first"),
      "tree/ali.HTML": strToU8("duplicate"),
      "../secret.txt": strToU8("unsafe"),
      "__MACOSX/tree/._Ali.html": strToU8("metadata"),
      "tree/.DS_Store": strToU8("metadata"),
    });
    const report = extractArchive(archive);
    expect(report.entries.map((entry) => entry.path)).toEqual(["tree/Ali.html"]);
    expect(report.skippedCounts).toMatchObject({ duplicate_path: 1, unsafe_path: 1, macos_metadata: 2 });
    expect(report.truncated).toBe(true);
  });

  it("enforces compression ratios and reports partial extraction", () => {
    const archive = zipSync({
      "tree/index.html": strToU8("Farhad"),
      "tree/repeated.txt": strToU8("family".repeat(10_000)),
    });
    const report = extractArchive(archive, { compressionRatio: 2 });
    expect(report.entries.map((entry) => entry.path)).toEqual(["tree/index.html"]);
    expect(report.skippedCounts.compression_ratio_too_high).toBe(1);
    expect(report.skippedTotal).toBe(1);
    expect(report.truncated).toBe(true);
  });

  it("does not treat active content as a photograph based on extension", () => {
    const archive = zipSync({ "tree/photo.png": strToU8("<svg><script>alert(1)</script></svg>") });
    const report = extractArchive(archive);
    expect(report.entries).toEqual([]);
    expect(report.skippedCounts.invalid_image).toBe(1);
  });
});
