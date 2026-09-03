import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** What this session's work is supposed to do, checked against the live site.
 *
 * Read-only by construction: nothing here writes to the family archive. The
 * access-control tests exercise the gates without changing the site's
 * visibility, because flipping that would lock the family out mid-visit. */

function session(email: string): string {
  // PLAYWRIGHT_SESSION_SECRET lets anyone run the suite against their own
  // deployment; the Keychain item is the reference instance's arrangement.
  const secret = process.env.PLAYWRIGHT_SESSION_SECRET || "";
  if (!secret) throw new Error("Set PLAYWRIGHT_SESSION_SECRET to your deployment's AUTH_SESSION_SECRET (and PLAYWRIGHT_BASE_URL / PLAYWRIGHT_MEMBER_EMAIL).");
  const b64 = (input: Buffer | string) => Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const payload = b64(JSON.stringify({ subject: "browser-suite", email, displayName: "Browser suite", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${payload}.${b64(createHmac("sha256", secret).update(payload).digest())}`;
}

async function ready(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator('main[data-hydrated="true"]')).toBeAttached();
}

async function openView(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(600);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "archive_session", value: session(process.env.PLAYWRIGHT_MEMBER_EMAIL || "browser-suite@example.com"), url: baseURL ?? "http://localhost:8787" }]);
});

test("the archive opens on the Tree", async ({ page }) => {
  await ready(page);
  await expect(page.locator(".archive-view-switcher button.is-active")).toHaveText("Tree");
});

test("hovering a card shows the record and moves nothing", async ({ page }) => {
  await ready(page);
  await openView(page, "Family");
  await page.locator(".ped-card button").first().waitFor();
  const board = () => page.locator(".ped-pan").getAttribute("style");
  const before = await board();
  const card = page.locator(".ped-siblings .ped-card button, .ped-col-parents .ped-card button").first();
  const box = await card.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 6 });
  await expect(page.locator(".person-hover-preview h2")).toBeVisible();
  await page.waitForTimeout(900);
  // the board is where it was: a hover says what a card is, it does not act
  expect(await board()).toBe(before);
});

test("clicking a card in the Family view leaves it exactly where it was", async ({ page }) => {
  await ready(page);
  await openView(page, "Family");
  await page.locator(".ped-card").first().waitFor();
  await page.waitForTimeout(1500);

  // the board arrives centred on the person whose record is open
  const centred = await page.evaluate(() => {
    const card = document.querySelector(".ped-col-focal .ped-couple > .ped-card")!.getBoundingClientRect();
    const stage = document.querySelector(".ped-stage")!.getBoundingClientRect();
    return { dx: (card.x + card.width / 2) - (stage.x + stage.width / 2), dy: (card.y + card.height / 2) - (stage.y + stage.height / 2) };
  });
  expect(Math.abs(centred.dx)).toBeLessThan(2);
  expect(Math.abs(centred.dy)).toBeLessThan(2);

  // and choosing someone rebuilds the family around them without moving them
  const card = page.locator(".ped-siblings .ped-card, .ped-col-parents .ped-card").first();
  const name = await card.locator("strong").innerText();
  const before = (await card.boundingBox())!;
  await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
  await page.waitForTimeout(2000);
  await expect(page.locator(".ped-col-focal .ped-couple > .ped-card strong")).toHaveText(name);
  const after = (await page.locator(".ped-col-focal .ped-couple > .ped-card").boundingBox())!;
  expect(Math.abs((after.x + after.width / 2) - (before.x + before.width / 2))).toBeLessThan(3);
  expect(Math.abs((after.y + after.height / 2) - (before.y + before.height / 2))).toBeLessThan(3);
});

test("hovering a name in the List previews that person", async ({ page }) => {
  await ready(page);
  await openView(page, "List");
  const name = page.locator(".outline-name").first();
  await name.waitFor();
  const box = await name.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 6 });
  await expect(page.locator(".person-hover-preview h2")).toBeVisible();
});

test("clicking a tree card opens its branch and leaves the card where it is", async ({ page }) => {
  await ready(page);
  await page.locator(".tree-card").first().waitFor();
  await page.waitForTimeout(1200);
  const target = await page.evaluate(() => {
    const visible = (r: DOMRect) => r.left > 40 && r.right < window.innerWidth - 40 && r.top > 120 && r.bottom < window.innerHeight - 60;
    for (const chip of document.querySelectorAll(".branch-chip")) {
      if (!chip.textContent?.startsWith("Show")) continue;
      const cr = chip.getBoundingClientRect();
      if (!visible(cr)) continue;
      let best: Element | null = null, bestDistance = Infinity;
      for (const card of document.querySelectorAll(".tree-card")) {
        const r = card.getBoundingClientRect();
        const distance = Math.hypot(r.left + r.width / 2 - (cr.left + cr.width / 2), r.bottom - cr.top);
        if (r.bottom <= cr.top + 6 && visible(r) && distance < bestDistance) { bestDistance = distance; best = card; }
      }
      if (best) { const r = best.getBoundingClientRect(); return { id: (best as HTMLElement).dataset.personId, x: Math.round(r.x), y: Math.round(r.y) }; }
    }
    return null;
  });
  test.skip(!target, "no folded branch is on camera at this size");
  const before = await page.locator(".tree-card").count();
  await page.locator(`[data-person-id="${target!.id}"]`).click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(1500);
  expect(await page.locator(".tree-card").count()).toBeGreaterThan(before);
  const after = await page.evaluate((id) => { const r = document.querySelector(`[data-person-id="${id}"]`)!.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }, target!.id);
  expect(Math.abs(after.x - target!.x)).toBeLessThan(4);
  expect(Math.abs(after.y - target!.y)).toBeLessThan(4);

  const branch = page.locator(`[data-branch-person-id="${target!.id}"]`);
  await expect(branch).toHaveText("Hide branch");
  await branch.click();
  await expect(branch).toContainText("Show");
  await expect.poll(() => page.locator(".tree-card").count()).toBeLessThan(before + 1);
  await branch.click();
  await expect(branch).toHaveText("Hide branch");
  await expect.poll(() => page.locator(".tree-card").count()).toBeGreaterThan(before);
});

test("a selected person's branch stays hidden until the user shows it again", async ({ page }) => {
  await ready(page);
  await page.locator(".tree-card").first().waitFor();
  const branchId = await page.evaluate(() => {
    const visible = (element: Element) => {
      const r = element.getBoundingClientRect();
      return r.left > 0 && r.right < window.innerWidth && r.top > 80 && r.bottom < window.innerHeight;
    };
    const chip = [...document.querySelectorAll(".branch-chip")].find((candidate) => candidate.textContent === "Hide branch" && visible(candidate));
    return (chip as HTMLElement | undefined)?.dataset.branchPersonId ?? null;
  });
  test.skip(!branchId, "no expanded branch is on camera at this size");
  await page.locator(`[data-person-id="${branchId}"]`).click();
  const branch = page.locator(`[data-branch-person-id="${branchId}"]`);
  await branch.click();
  await expect(branch).toContainText("Show");
  await page.waitForTimeout(500);
  await expect(branch).toContainText("Show");
  await branch.click();
  await expect(branch).toHaveText("Hide branch");
});

test("the map zooms on open ground, not on a city, and names both", async ({ page }) => {
  await ready(page);
  await openView(page, "Map");
  await expect(page.locator(".world-map")).toHaveAttribute("data-framed", "true");
  const scale = () => page.locator(".world-map-layer").evaluate((el) => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? 1));

  // every city says what it is: none may be silenced for want of room
  const sides = await page.locator(".map-marker").evaluateAll((markers) =>
    markers.map((m) => [...m.classList].find((c) => c.startsWith("is-"))));
  expect(sides.filter((side) => side === "is-quiet")).toHaveLength(0);

  const marker = await page.locator(".map-marker span").first().boundingBox();
  const before = await scale();
  await page.mouse.dblclick(marker!.x + marker!.width / 2, marker!.y + marker!.height / 2);
  await page.waitForTimeout(700);
  expect(await scale()).toBeCloseTo(before, 3);
  await expect(page.locator(".place-panel")).toBeVisible();

  const map = await page.locator(".world-map").boundingBox();
  await page.mouse.dblclick(map!.x + 80, map!.y + map!.height - 80);
  await expect.poll(scale).toBeGreaterThan(before);
});

test("hovering a city previews who is recorded there", async ({ page }) => {
  await ready(page);
  await openView(page, "Map");
  await expect(page.locator(".world-map")).toHaveAttribute("data-framed", "true");
  const marker = await page.locator(".map-marker").first().boundingBox();
  await page.mouse.move(marker!.x + 8, marker!.y + marker!.height / 2, { steps: 6 });
  await expect(page.locator(".person-hover-preview .place-panel")).toBeVisible();
});

test("a member who has not said who they are is asked", async ({ page }) => {
  await ready(page);
  await expect(page.locator(".identify-card")).toBeVisible();
  await page.locator(".identify-card input").fill("Mohammad");
  const suggestions = page.locator(".identify-matches button");
  await expect(suggestions.first()).toBeVisible();
  // a repeated name is told apart by its parents, not by the name
  await expect(suggestions.first()).toContainText("child of");
  await page.locator(".identify-skip").click();
  await expect(page.locator(".identify-card")).toHaveCount(0);
});

test("the archivist answers in the language it was asked in", async ({ page }) => {
  const persian = await page.request.post("/api/ask", { data: { message: "چند نفر در این شجره‌نامه ثبت شده‌اند؟" } });
  expect(persian.ok()).toBeTruthy();
  const reply = (await persian.json()).reply as string;
  expect(reply).toMatch(/[؀-ۿ]/);
});

test("access control refuses anonymous callers and answers admins only", async ({ page, browser }) => {
  const anon = await browser.newContext();
  expect((await anon.request.get("/api/site")).status()).toBe(401);
  expect((await anon.request.post("/api/ingest")).status()).toBe(401);
  expect((await anon.request.get("/api/ingest")).status()).toBe(401);
  // the password endpoint says nothing while the archive is not behind one
  const access = await anon.request.post("/api/access", { data: { password: "x" } });
  expect([400, 401]).toContain(access.status());
  await anon.close();
  // a member who is not an admin cannot read or change the site's access
  expect((await page.request.get("/api/site")).status()).toBe(403);
});

test("uploading a document needs a form and an editor", async ({ page, browser }) => {
  const anon = await browser.newContext();
  expect((await anon.request.post("/api/documents")).status()).toBe(401);
  await anon.close();
  // a view-only member is not an editor
  expect((await page.request.post("/api/documents")).status()).toBe(403);
});

for (const [label, width, height] of [["iPhone", 390, 844], ["iPad mini portrait", 744, 1133], ["iPad portrait", 820, 1180], ["iPad landscape", 1180, 820], ["iPad Pro landscape", 1366, 1024]] as const) {
  test(`${label} fits the screen and every control is thumb-sized`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    await context.addCookies([{ name: "archive_session", value: session(process.env.PLAYWRIGHT_MEMBER_EMAIL || "browser-suite@example.com"), url: baseURL ?? "http://localhost:8787" }]);
    const page = await context.newPage();
    await ready(page);
    await page.waitForTimeout(2500);
    const report = await page.evaluate(() => ({
      inner: window.innerWidth,
      doc: document.documentElement.scrollWidth,
      small: [...document.querySelectorAll("button, a[href], select, input")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.height < 43 || r.width < 43) && !el.className.toString().includes("sr-only");
      }).map((el) => `${(el.className || el.tagName).toString().slice(0, 30)}`),
    }));
    // a page wider than the screen makes a mobile browser zoom the whole
    // archive out, which is how it once rendered at a third of its size
    expect(report.inner).toBe(width);
    expect(report.doc).toBeLessThanOrEqual(report.inner + 1);
    expect(report.small, `controls under Apple's 44pt: ${report.small.join(", ")}`).toEqual([]);

    // every view must be reachable: either the strip shows all its segments,
    // or it has given way to the picker, which holds them all
    const views = await page.evaluate(() => {
      const strip = document.querySelector(".archive-view-switcher");
      const picker = document.querySelector(".archive-view-picker select") as HTMLSelectElement | null;
      const stripShown = strip ? getComputedStyle(strip).display !== "none" : false;
      if (!stripShown) return { control: "picker", total: picker?.options.length ?? 0, reachable: picker?.options.length ?? 0 };
      const tabs = [...strip!.querySelectorAll("button")];
      const onScreen = tabs.filter((b) => { const r = b.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1; });
      return { control: "strip", total: tabs.length, reachable: onScreen.length };
    });
    expect(views.total).toBeGreaterThan(4);
    expect(views.reachable, `${views.control} hides views`).toBe(views.total);
    await context.close();
  });
}
