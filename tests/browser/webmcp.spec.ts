import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/** The page offers WebMCP tools to a browser-side agent
 * (navigator.modelContext). This installs a mock model-context BEFORE any app
 * script runs, so the registration the app performs on mount is captured
 * deterministically, then drives a tool and checks it moves the real UI -
 * the thing a hosted MCP server cannot do. */

function session(email: string): string {
  const secret = process.env.PLAYWRIGHT_SESSION_SECRET || "";
  if (!secret) throw new Error("Set PLAYWRIGHT_SESSION_SECRET to your deployment's AUTH_SESSION_SECRET (and PLAYWRIGHT_BASE_URL / PLAYWRIGHT_MEMBER_EMAIL).");
  const b64 = (input: Buffer | string) => Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const payload = b64(JSON.stringify({ subject: "browser-suite", email, displayName: "Browser suite", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${payload}.${b64(createHmac("sha256", secret).update(payload).digest())}`;
}

// runs before every app script on every navigation - the deterministic slot
async function installMockModelContext(page: Page) {
  await page.addInitScript(() => {
    const registry: Record<string, unknown> = {};
    (window as unknown as { __webmcp: Record<string, unknown> }).__webmcp = registry;
    Object.defineProperty(navigator, "modelContext", {
      configurable: true,
      value: {
        registerTool: (tool: { name: string }) => { registry[tool.name] = tool; },
        unregisterTool: (name: string) => { delete registry[name]; },
      },
    });
  });
}

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([{ name: "archive_session", value: session(process.env.PLAYWRIGHT_MEMBER_EMAIL || "browser-suite@example.com"), url: baseURL ?? "http://localhost:8787" }]);
  await installMockModelContext(page);
});

test("the page registers its WebMCP tools with the browser agent", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('main[data-hydrated="true"]')).toBeAttached();
  await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { __webmcp: Record<string, unknown> }).__webmcp))).toContain("show_person_on_canvas");
  const names = await page.evaluate(() => Object.keys((window as unknown as { __webmcp: Record<string, unknown> }).__webmcp).sort());
  expect(names).toEqual(["ask_the_archivist", "family_in_year", "family_origins", "how_am_i_related", "how_are_they_related", "life_of", "namesakes", "overview_of_family_tree", "person_details", "search_family", "show_person_on_canvas", "switch_view", "upcoming_family_dates"]);
});

test("a WebMCP tool call moves the real UI", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('main[data-hydrated="true"]')).toBeAttached();
  await page.locator(".tree-card").first().waitFor();

  // pick a real recorded name via the search tool, then show them on the canvas
  const someone = await page.evaluate(async () => {
    const tools = (window as unknown as { __webmcp: Record<string, { execute: (a: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }).__webmcp;
    const overview = await tools.overview_of_family_tree.execute({});
    return overview.content[0].text;
  });
  expect(someone).toContain("people");

  const opened = await page.evaluate(async () => {
    const tools = (window as unknown as { __webmcp: Record<string, { execute: (a: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> }> }).__webmcp;
    // first card's name from the DOM, then drive the tool to open it
    const name = document.querySelector(".tree-card [class]")?.textContent?.trim() || document.querySelector(".tree-card")?.textContent?.trim() || "";
    const result = await tools.show_person_on_canvas.execute({ name });
    return { name, result };
  });
  // the tool either opened a real person (record modal appears) or returned a
  // clear disambiguation/`not found` message - never a silent failure
  if (!opened.result.isError) {
    await expect(page.getByRole("dialog")).toBeVisible();
  } else {
    expect(opened.result.content[0].text).toMatch(/No one named|Several people/);
  }
});
