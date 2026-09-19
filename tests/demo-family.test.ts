import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET } from "../app/demo/sample/route";
import { sampleFamily, sampleGedcom, startingFamily } from "../lib/demo-family";
import { buildGedcom } from "../lib/gedcom";
import { parseGedcom } from "../lib/gedcom-import";
import { redactLivingDetails } from "../lib/living-privacy";

describe("public synthetic examples", () => {
  it("parses the checked-in download without warnings and links four generations", () => {
    expect(sampleGedcom).toBe(readFileSync("examples/rowan-family.ged", "utf8"));
    expect(parseGedcom(sampleGedcom)).toMatchObject({ people: 12, families: 5, relationships: 17, warnings: [] });
    const tree = sampleFamily();
    const id = (name: string) => tree.people.find((person) => person.displayName === name)!.id;
    for (const [parent, child] of [["Évelyn Vale", "Leo Rowan"], ["Leo Rowan", "Nora Rowan"], ["Nora Rowan", "June Ortiz"]]) {
      expect(tree.relationships).toContainEqual(expect.objectContaining({ fromPersonId: id(parent), toPersonId: id(child), type: "parent" }));
    }
    expect(new Set(tree.relationships.map((link) => `${link.type}:${link.fromPersonId}:${link.toPersonId}`)).size).toBe(17);
    for (const person of tree.people) {
      expect(person.biography).toContain("Fictional");
      expect(person.photoAttachmentId).toBeNull();
    }
  });

  it("preserves precise, partial and unknown dates through export and re-import", () => {
    const original = parseGedcom(sampleGedcom);
    const exported = parseGedcom(buildGedcom(sampleFamily(), "https://example.com", "Synthetic example", "SYNTHETIC"));
    expect(exported.warnings).toEqual([]);
    expect(exported.people).toBe(original.people);
    expect(exported.relationships).toBe(original.relationships);
    const people = exported.proposals.filter((proposal) => proposal.kind === "add_person").map((proposal) => proposal.person);
    expect(people).toEqual(original.proposals.filter((proposal) => proposal.kind === "add_person").map((proposal) => proposal.person));
    expect(people.find((person) => person.displayName === "Nora Rowan")?.birthDate).toBe("1978-05-14");
    expect(people.find((person) => person.displayName === "Luis Linden")?.birthDate).toBe("1920-03");
    expect(people.find((person) => person.displayName === "Alex Chen")?.birthDate).toBeNull();
    const links = (report: typeof original) => report.proposals.filter((proposal) => proposal.kind === "add_relationship")
      .map((proposal) => `${proposal.relationshipType}:${proposal.relationshipType === "spouse" ? [proposal.fromPersonName, proposal.toPersonName].sort().join(":") : `${proposal.fromPersonName}:${proposal.toPersonName}`}`).sort();
    expect(links(exported)).toEqual(links(original));
  });

  it("starts and resets with an independent founding couple", () => {
    const base = startingFamily();
    expect(base.people.map((person) => person.displayName)).toEqual(["Maya Rowan", "Leo Rowan"]);
    expect(base.relationships).toHaveLength(1);
    base.people[0].displayName = "Changed in this tab";
    expect(startingFamily().people[0].displayName).toBe("Maya Rowan");
    expect(sampleFamily().people[0].displayName).toBe("Maya Rowan");
  });

  it("exercises public redaction without changing the downloadable fiction", () => {
    const full = sampleFamily();
    const redacted = redactLivingDetails(full);
    expect(redacted.people.find((person) => person.displayName === "Nora Rowan")).toMatchObject({ birthDate: "1978", birthPlace: null, biography: null });
    expect(redacted.people.find((person) => person.displayName === "Évelyn Vale")?.biography).toContain("Fictional");
    expect(full.people.find((person) => person.displayName === "Nora Rowan")?.birthDate).toBe("1978-05-14");
  });

  it("serves only the bundled fixture as a named UTF-8 download", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="rowan-family.ged"');
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe(sampleGedcom);
  });
});
