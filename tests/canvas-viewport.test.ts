import { describe, expect, it } from "vitest";
import { centerViewOn, clampScale, clampToContent, openCollapsedPath, panView, toggleCollapsedBranch, zoomView } from "../app/components/FamilyTreeCanvas";

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

describe("the camera stays where the family is", () => {
  const content = { minX: -1000, maxX: 1000, minY: 0, maxY: 2000 };
  const viewport = { width: 800, height: 600 };
  it("lets a wide tree be panned to either edge and no further", () => {
    const farLeft = clampToContent({ x: -99999, y: 0, scale: 1 }, content, viewport);
    // a strip of the tree is still on screen, and no more can be pushed away
    expect(farLeft.x).toBeCloseTo(160 - 1000, 5);
    const farRight = clampToContent({ x: 99999, y: 0, scale: 1 }, content, viewport);
    expect(farRight.x).toBeCloseTo(800 - 160 + 1000, 5);
    // and a view already inside the bounds is left exactly as it was
    expect(clampToContent({ x: 120, y: -300, scale: 1 }, content, viewport)).toEqual({ x: 120, y: -300, scale: 1 });
  });
  it("still lets a tree smaller than the window be moved, without losing it", () => {
    const small = { minX: 0, maxX: 200, minY: 0, maxY: 100 };
    // it may leave, but never entirely: a strip of it stays against the edge
    expect(clampToContent({ x: -500, y: 0, scale: 1 }, small, viewport).x).toBeCloseTo(-40, 5);
    expect(clampToContent({ x: 5000, y: 0, scale: 1 }, small, viewport).x).toBeCloseTo(640, 5);
    // and a modest nudge is left alone, so dragging never feels stuck
    expect(clampToContent({ x: 40, y: 0, scale: 1 }, small, viewport).x).toBe(40);
  });
  it("bounds by what is on screen, so zooming out loosens the leash", () => {
    const far = clampToContent({ x: -99999, y: 0, scale: 0.5 }, content, viewport);
    expect(far.x).toBeCloseTo(160 - 500, 5);
  });
  it("does nothing until it knows the window or the cards", () => {
    const view = { x: 7, y: 9, scale: 1 };
    expect(clampToContent(view, null, viewport)).toBe(view);
    expect(clampToContent(view, content, { width: 0, height: 0 })).toBe(view);
  });
});
