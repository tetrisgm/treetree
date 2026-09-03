import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { VERSION } from "../../lib/build";

// The live site is members-only, so every UI test carries a minted session
// for the dedicated browser-suite viewer member. The session secret's
// durable copy lives in the Mac login Keychain (fleet rule).
function viewerSessionCookie(): string {
  // PLAYWRIGHT_SESSION_SECRET lets anyone run the suite against their own
  // deployment; the Keychain item is the reference instance's arrangement.
  const secret = process.env.PLAYWRIGHT_SESSION_SECRET || "";
  if (!secret) throw new Error("Set PLAYWRIGHT_SESSION_SECRET to your deployment's AUTH_SESSION_SECRET (and PLAYWRIGHT_BASE_URL / PLAYWRIGHT_MEMBER_EMAIL).");
  const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const payload = b64url(JSON.stringify({ subject: "browser-suite", email: process.env.PLAYWRIGHT_MEMBER_EMAIL || "browser-suite@example.com", displayName: "Browser suite", exp: Math.floor(Date.now() / 1000) + 3600 }));
  const signature = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${signature}`;
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "archive_session", value: viewerSessionCookie(), url: baseURL ?? "http://localhost:8787" }]);
});

/** The page is server-rendered, so it is on screen before React attaches to
 *  it and a click in that window does nothing at all. Every test that
 *  interacts waits for the app to say it is ready. */
async function openArchive(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator('main[data-hydrated="true"]')).toBeAttached();
}

async function openFullTree(page: Page) {
  await openArchive(page);
  await page.getByRole("button", { name: "Tree", exact: true }).click();
  await page.locator(".tree-card").first().waitFor();
}

async function onCameraCard(page: Page): Promise<Locator> {
  const canvas = await page.locator(".family-canvas").boundingBox();
  if (!canvas) throw new Error("Family canvas is not visible");
  const cards = page.locator(".tree-card");
  for (let index = 0; index < await cards.count(); index += 1) {
    const box = await cards.nth(index).boundingBox();
    if (!box) continue;
    // Playwright aims at the centre, so a card is only "on camera" when its
    // centre is inside the stage and not buried under the chat sidebar, its
    // resize handle, or the zoom controls - a human clicks the visible part,
    // the runner cannot.
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (x < canvas.x || x > canvas.x + canvas.width || y < canvas.y + 64 || y > canvas.y + canvas.height) continue;
    const hittable = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest(".tree-card") !== null,
      { x, y },
    );
    if (hittable) return cards.nth(index);
  }
  throw new Error("No family card is currently on camera");
}

async function emptyCanvasPoint(page: Page) {
  return page.locator(".family-canvas").evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    for (let y = rect.top + 90; y < rect.bottom - 80; y += 40) {
      for (let x = rect.left + 40; x < rect.right - 40; x += 40) {
        if (document.elementFromPoint(x, y)?.classList.contains("canvas-hit-surface")) return { x, y };
      }
    }
    throw new Error("No empty canvas point is on camera");
  });
}

test("public tree renders as an interactive canvas beside the archive chat", async ({ page }) => {
  await openFullTree(page);
  await expect(page.locator(".family-canvas")).toBeVisible();
  await expect(page.locator(".chat-sidebar")).toBeVisible();
  expect(await page.locator(".tree-card").count()).toBeGreaterThan(0);
  await expect(page.locator(".tree-connectors line")).not.toHaveCount(0);
  await expect(page.locator(".public-chat")).toBeVisible();
});

test("chat sidebar collapses and returns from the left edge", async ({ page }) => {
  await openArchive(page);
  const sidebar = page.locator(".chat-sidebar");
  await sidebar.getByRole("button", { name: "Collapse family chat" }).click();
  await expect(sidebar).toHaveClass(/is-collapsed/);
  await expect(page.locator(".chat-edge-reveal")).toHaveClass(/is-visible/);
  await page.locator(".chat-edge-reveal").click();
  await expect(sidebar).not.toHaveClass(/is-collapsed/);
});

test("a person card opens a navigable record", async ({ page }) => {
  await openFullTree(page);
  await (await onCameraCard(page)).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".person-panel")).toBeVisible();
  await expect(page.locator(".person-modal-v2 h2")).toBeVisible();
});

test("canvas wheel pans the camera without scrolling the document", async ({ page }) => {
  await openFullTree(page);
  const canvas = page.locator(".family-canvas");
  await canvas.hover();
  const before = await page.locator(".tree-viewport").evaluate((element) => element.style.transform);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => page.locator(".tree-viewport").evaluate((element) => element.style.transform)).not.toBe(before);
  await expect(canvas).toHaveCSS("touch-action", "none");
  await expect(page.locator("html")).toHaveCSS("overscroll-behavior", "none");
});

test("canvas zoom buttons scale the viewport", async ({ page }) => {
  await openFullTree(page);
  const scaleOf = () => page.locator(".tree-viewport").evaluate((element) => Number(element.style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1));
  expect(await scaleOf()).toBeCloseTo(1, 5);
  await page.getByRole("button", { name: "Zoom in" }).first().click();
  await expect.poll(scaleOf).toBeGreaterThan(1.05);
  await page.getByRole("button", { name: "Zoom out" }).first().click();
  await page.getByRole("button", { name: "Zoom out" }).first().click();
  await expect.poll(scaleOf).toBeLessThan(1);
});

test("zoom controls do not show the canvas hand cursor", async ({ page }) => {
  await openFullTree(page);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.hover();
  await expect(page.locator(".tree-custom-cursor")).toHaveAttribute("data-visible", "false");
});

test("canvas and cards expose distinct cursor affordances", async ({ page }) => {
  await openFullTree(page);
  await expect(page.locator(".family-canvas")).toHaveAttribute("data-interactive", "true");
  await expect(page.locator(".family-canvas")).toHaveCSS("cursor", "none");
  await expect(page.locator(".canvas-hit-surface")).toHaveCSS("cursor", "none");
  await expect(page.locator(".tree-card").first()).toHaveCSS("cursor", "none");
});

test("live page exposes an uncached deployment identity", async ({ page }) => {
  await openArchive(page);
  const build = await page.locator("main[data-build-id]").getAttribute("data-build-id");
  const version = await page.locator("main[data-version]").getAttribute("data-version");
  expect(build).toMatch(/^[0-9a-f]{7,}$/);
  // The suite verifies the deployed site, so the expected identity is the
  // checkout's own: deploy before running, or the mismatch is the finding.
  expect(version).toBe(String(VERSION));
  const response = await page.request.get("/api/version");
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).build).toBe(build);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("timeline and map are generated from the same public family records", async ({ page }) => {
  await openArchive(page);
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.getByRole("region", { name: "Family timeline" })).toBeVisible();
  await page.getByRole("button", { name: "Map" }).click();
  await expect(page.getByRole("region", { name: "Family places" })).toBeVisible();
  // the map opens by framing itself on the family's places; measuring a pan
  // before that lands measures the framing instead
  await expect(page.locator(".world-map")).toHaveAttribute("data-framed", "true");
  // the map pans and zooms like the other canvases
  const mapScale = () => page.locator(".world-map-layer").evaluate((element) => Number((element as HTMLElement).style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1));
  await page.getByRole("group", { name: "Map zoom controls" }).getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(mapScale).toBeGreaterThan(1.05);
  // the map opens framed on the family's places, so the pan is a delta from
  // wherever that framing put it, not an absolute offset
  const panOf = () => page.locator(".world-map-layer").evaluate((element) => {
    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((element as HTMLElement).style.transform);
    return { x: Number(match?.[1] ?? 0), y: Number(match?.[2] ?? 0) };
  });
  const beforePan = await panOf();
  const mapBox = await page.locator(".world-map").boundingBox();
  await page.mouse.move(mapBox!.x + mapBox!.width / 2, mapBox!.y + mapBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(mapBox!.x + mapBox!.width / 2 + 80, mapBox!.y + mapBox!.height / 2 + 40, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => {
    const now = await panOf();
    return { dx: Math.round(now.x - beforePan.x), dy: Math.round(now.y - beforePan.y) };
  }).toEqual({ dx: 80, dy: 40 });
  // a city opens as a list of its people; a row opens the profile; closing it returns to the list
  await page.locator(".map-marker").first().click();
  await expect(page.locator(".place-panel")).toBeVisible();
  expect(await page.locator(".place-person-row").count()).toBeGreaterThan(0);
  await page.locator(".place-person-row").first().click();
  await expect(page.locator(".person-modal-v2 h2")).toBeVisible();
  await page.locator(".person-panel-bar .person-nav-close").click();
  await expect(page.locator(".place-panel")).toBeVisible();
  await page.getByRole("button", { name: "Tree" }).click();
  await expect(page.locator(".family-canvas")).toBeVisible();
});

test("Safari gets a visible custom grab cursor and clickable-card cursor", async ({ page }) => {
  await openFullTree(page);
  const canvas = page.locator(".family-canvas");
  await expect(canvas).toHaveAttribute("data-interactive", "true");
  await expect(canvas).toBeVisible();
  const emptyPoint = await emptyCanvasPoint(page);
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("canvas-hit-surface"), emptyPoint)).toBe(true);
  await expect(page.locator(".tree-custom-cursor")).toHaveAttribute("data-mode", "grab");
  await expect(page.locator(".tree-custom-cursor")).toHaveAttribute("data-visible", "true");
  await expect(page.locator(".tree-custom-cursor")).toHaveCSS("opacity", "1");
  const card = await onCameraCard(page);
  await card.hover();
  await expect(page.locator(".tree-custom-cursor")).toHaveAttribute("data-mode", "pointer");
  // branch chips carry their own cursor rule and once showed the native hand
  // on top of the app-drawn one; they must behave exactly like cards
  const chips = page.locator(".branch-chip");
  for (let index = 0; index < await chips.count(); index += 1) {
    const chipBox = await chips.nth(index).boundingBox();
    const canvasBox = await canvas.boundingBox();
    if (!chipBox || !canvasBox || chipBox.y < canvasBox.y + 64 || chipBox.y + chipBox.height > canvasBox.y + canvasBox.height) continue;
    await expect(chips.nth(index)).toHaveCSS("cursor", "none");
    await chips.nth(index).hover();
    await expect(page.locator(".tree-custom-cursor")).toHaveAttribute("data-mode", "pointer");
    await expect(page.locator(".tree-custom-cursor")).toHaveAttribute("data-visible", "true");
    break;
  }
  const text = card.locator("strong");
  const box = await text.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".tree-card") !== null, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })).toBe(true);
});

test("dragging the dedicated surface pans while a card remains clickable", async ({ page }) => {
  await openFullTree(page);
  await expect(page.locator(".family-canvas")).toHaveAttribute("data-interactive", "true");
  await expect(page.locator(".family-canvas")).toBeVisible();
  const viewport = page.locator(".tree-viewport");
  const before = await viewport.getAttribute("style");
  const start = await emptyCanvasPoint(page);
  await page.mouse.move(start.x, start.y);
  await expect(page.locator(".tree-custom-cursor")).toHaveAttribute("data-visible", "true");
  await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y + 70, { steps: 4 });
  await expect(page.locator(".family-canvas")).toHaveAttribute("data-panning", "true");
  await expect(page.locator(".tree-custom-cursor")).toHaveAttribute("data-mode", "grabbing");
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("style", before!);
  await expect(page.locator(".family-canvas")).toHaveAttribute("data-panning", "false");
  await (await onCameraCard(page)).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the settings page offers sign-in and explains member roles", async ({ browser, baseURL }) => {
  const anonymous = await browser.newContext({ baseURL: baseURL ?? "https://archive.example" });
  const page = await anonymous.newPage();
  await page.goto("/settings");
  await expect(page.locator("h1")).toHaveText("Settings");
  await expect(page.getByText("Sign in with Apple")).toBeVisible();
  await anonymous.close();
});

test("the members-only gate covers the tree and its APIs", async ({ request }) => {
  const tree = await request.get("/api/tree");
  test.skip(tree.status() === 200, "the site is currently in public visibility");
  expect(tree.status()).toBe(401);
});

test("member management refuses anonymous requests", async ({ request }) => {
  const listing = await request.get("/api/members");
  expect(listing.status()).toBe(401);
  // the Fill-in review queue is editor-gated the same way
  expect((await request.get("/api/questions")).status()).toBe(401);
  expect((await request.post("/api/questions", { data: { id: "oq-x", verdict: "confirm" } })).status()).toBe(401);
  const mutation = await request.post("/api/members", { data: { action: "set", email: "intruder@example.com", role: "admin" } });
  expect(mutation.status()).toBe(401);
});

test("site access settings are admin-gated", async ({ request }) => {
  const mutation = await request.post("/api/site", { data: { visibility: "members" } });
  expect(mutation.status()).toBe(401);
  // the tree endpoint answers deliberately in either visibility mode
  expect([200, 401]).toContain((await request.get("/api/tree")).status());
});
