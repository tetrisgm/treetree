import { describe, expect, it, vi } from "vitest";
import { WEBMCP_TOOLS, type WebMcpActions } from "../lib/webmcp-tools";
import type { FamilyTree, Person } from "../lib/types";

const person = (id: string, displayName: string, extra: Partial<Person> = {}): Person => ({
  id, displayName, gender: null, givenName: null, familyName: null, maidenName: null,
  birthDate: null, deathDate: null, birthPlace: null, deathPlace: null, birthCity: null,
  birthCountry: null, deathCity: null, deathCountry: null, burialPlace: null, residence: null,
  biography: null, photoAttachmentId: null, ...extra,
});

const tree: FamilyTree = {
  people: [
    person("p1", "Farhad Golestani", { birthDate: "1940", birthCity: "Tehran" }),
    person("p2", "Mina Golestani"),
    person("p3", "Roya Golestani", { birthDate: "1972" }),
  ],
  relationships: [
    { id: "r1", fromPersonId: "p1", toPersonId: "p2", type: "spouse", status: "married" },
    { id: "r2", fromPersonId: "p1", toPersonId: "p3", type: "parent", status: null },
  ],
  stories: [],
};

const actions = (): WebMcpActions & { focused: Person[]; views: string[] } => {
  const focused: Person[] = [];
  const views: string[] = [];
  return { focused, views, egoId: "p3", focusPerson: (p) => focused.push(p), setView: (v) => views.push(v), askArchivist: vi.fn(async () => "archivist says hi") };
};

const run = (name: string, args: Record<string, unknown>, act: WebMcpActions) => {
  const tool = WEBMCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool.execute(args, tree, act);
};

describe("webmcp tools", () => {
  it("overviews the tree", () => {
    expect(run("overview_of_family_tree", {}, actions())).toContain("3 people");
  });

  it("searches and details a person", () => {
    expect(run("search_family", { query: "roya" }, actions())).toContain("Roya Golestani");
    expect(run("person_details", { name: "Farhad Golestani" }, actions())).toContain("Children: Roya Golestani");
  });

  it("refuses an ambiguous person name", () => {
    expect(() => run("person_details", { name: "Golestani" }, actions())).toThrow(/Several people/);
  });

  it("drives the canvas: focuses a person and forces the tree view", () => {
    const act = actions();
    const message = run("show_person_on_canvas", { name: "Roya Golestani" }, act) as string;
    expect(message).toContain("Roya Golestani");
    expect(act.focused.map((p) => p.id)).toEqual(["p3"]);
    expect(act.views).toContain("tree");
  });

  it("switches views", () => {
    const act = actions();
    run("switch_view", { view: "map" }, act);
    expect(act.views).toEqual(["map"]);
  });

  it("delegates free-form questions to the archivist", async () => {
    const act = actions();
    expect(await run("ask_the_archivist", { question: "who is oldest?" }, act)).toBe("archivist says hi");
    expect(act.askArchivist).toHaveBeenCalledWith("who is oldest?");
  });

  it("explains a relationship", () => {
    expect(run("how_are_they_related", { person_a: "Roya Golestani", person_b: "Farhad Golestani" }, actions())).toMatch(/father|parent/i);
  });
});
