import { describe, expect, it } from "vitest";
import { centerViewOn, clampScale, openCollapsedPath, panView, toggleCollapsedBranch, zoomView } from "../app/components/FamilyTreeCanvas";

describe("family canvas viewport math", () => {
  it("keeps zoom within usable bounds", () => {
    expect(clampScale(0.1)).toBe(0.5);
    expect(clampScale(10)).toBe(3);
  });

  it("keeps the point beneath the cursor fixed while zooming", () => {
    const before = { x: 40, y: -20, scale: 1 };
    const cursor = { x: 120, y: 80 };
    const after = zoomView(before, 2, cursor);
    expect(after.scale).toBe(2);
    expect((cursor.x - after.x) / after.scale).toBe((cursor.x - before.x) / before.scale);
    expect((cursor.y - after.y) / after.scale).toBe((cursor.y - before.y) / before.scale);
  });

  it("derives a pan from the gesture-start camera without mutating it", () => {
    const before = { x: 40, y: -20, scale: 1.25 };
    expect(panView(before, { x: 75, y: -30 })).toEqual({ x: 115, y: -50, scale: 1.25 });
    expect(before).toEqual({ x: 40, y: -20, scale: 1.25 });
  });

  it("centers a world point at every zoom level", () => {
    const view = centerViewOn(
      { x: 900, y: -300, scale: 2 },
      { x: 175, y: 80 },
      { width: 1_000, height: 600 },
    );
    expect(view).toEqual({ x: 150, y: 140, scale: 2 });
    expect(view.x + 175 * view.scale).toBe(500);
    expect(view.y + 80 * view.scale).toBe(300);
  });

  it("opens the entire clicked branch and every folded ancestor in one pass", () => {
    const collapsed = new Set(["grandparent", "parent", "child", "grandchild", "great-grandchild", "other"]);
    const parents = new Map([["child", "parent"], ["parent", "grandparent"]]);
    const children = new Map([
      ["child", ["grandchild"]],
      ["grandchild", ["great-grandchild"]],
    ]);

    expect([...openCollapsedPath(collapsed, "child", parents, children)]).toEqual(["other"]);
    expect([...collapsed]).toEqual(["grandparent", "parent", "child", "grandchild", "great-grandchild", "other"]);
  });

  it("is safe to run again when selection state has not changed", () => {
    const collapsed = new Set(["other"]);
    const parents = new Map([["child", "parent"]]);

    expect(openCollapsedPath(collapsed, "child", parents)).toEqual(collapsed);
  });

  it("toggles one branch without mutating or losing other folded branches", () => {
    const collapsed = new Set(["first", "second"]);
    expect(toggleCollapsedBranch(collapsed, "first")).toEqual(new Set(["second"]));
    expect(toggleCollapsedBranch(collapsed, "third")).toEqual(new Set(["first", "second", "third"]));
    expect(collapsed).toEqual(new Set(["first", "second"]));
  });
});
