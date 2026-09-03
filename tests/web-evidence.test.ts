import { describe, expect, it } from "vitest";
import { extractEvidenceUrls, htmlToEvidenceText } from "../lib/web-evidence";

describe("web links as evidence", () => {
  it("extracts https links from prose, dropping trailing punctuation and duplicates", () => {
    expect(extractEvidenceUrls("Her obituary is at https://example.com/obit/123, and also https://example.com/obit/123."))
      .toEqual(["https://example.com/obit/123"]);
  });

  it("refuses http, bare addresses, and caps the count", () => {
    expect(extractEvidenceUrls("http://insecure.example.com/page")).toEqual([]);
    expect(extractEvidenceUrls("https://192.168.1.50/admin")).toEqual([]);
    const many = extractEvidenceUrls("https://a.example/1 https://b.example/2 https://c.example/3 https://d.example/4");
    expect(many).toHaveLength(3);
  });

  it("keeps a message with no links silent", () => {
    expect(extractEvidenceUrls("Kazem was born in Qazvin in 1921.")).toEqual([]);
  });

  it("turns a page into readable text", () => {
    const text = htmlToEvidenceText("<html><head><style>p{color:red}</style><script>evil()</script></head><body><h1>Obituary</h1><p>Beloved &amp; remembered, died 4 May 1998.</p></body></html>");
    expect(text).toContain("Obituary");
    expect(text).toContain("Beloved & remembered, died 4 May 1998.");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("color:red");
  });
});
