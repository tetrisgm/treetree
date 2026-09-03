import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  cachedTreeJson: vi.fn(),
  getSiteVisibility: vi.fn(),
  readAttachment: vi.fn(),
  readTree: vi.fn(),
}));
const authz = vi.hoisted(() => ({
  isArchiveMember: vi.fn(),
  requireEditor: vi.fn(),
  requireVisitor: vi.fn(),
}));

vi.mock("../db/store", () => store);
vi.mock("../app/authz", () => authz);

import { GET as getPhoto } from "../app/api/photos/[id]/route";
import { GET as getFile } from "../app/api/files/[id]/route";
import { GET as getTree } from "../app/api/tree/route";

type Visibility = "public" | "members" | "password";

beforeEach(() => {
  vi.clearAllMocks();
  authz.requireVisitor.mockResolvedValue({ ok: true, visibility: "public" });
  authz.requireEditor.mockResolvedValue({ ok: true });
  authz.isArchiveMember.mockResolvedValue(true);
  store.cachedTreeJson.mockReturnValue('{"people":[]}');
  store.readTree.mockResolvedValue({ people: [] });
  store.readAttachment.mockResolvedValue({
    metadata: { contentType: "image/jpeg", filename: "portrait.jpg" },
    object: { body: "portrait", writeHttpMetadata: vi.fn() },
  });
});

describe("archive cache policy", () => {
  it("allows shared caching only when the tree is public", async () => {
    authz.requireVisitor.mockResolvedValue({ ok: true, visibility: "public" satisfies Visibility });

    const response = await getTree();

    expect(response.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=120");
    expect(response.headers.has("vary")).toBe(false);
  });

  it.each(["password", "members"] satisfies Visibility[])(
    "prevents shared caching of a %s-gated tree",
    async (visibility) => {
      authz.requireVisitor.mockResolvedValue({ ok: true, visibility });

      const response = await getTree();

      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("vary")).toBe("Cookie");
    },
  );

  it("prevents caching of a visitor denial", async () => {
    authz.requireVisitor.mockResolvedValue({
      ok: false,
      response: new Response("Password required", { status: 401 }),
    });

    const response = await getTree();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("allows shared caching only when photographs are public", async () => {
    authz.requireVisitor.mockResolvedValue({ ok: true, visibility: "public" satisfies Visibility });

    const response = await getPhoto(new Request("https://archive.example/api/photos/photo-1"), {
      params: Promise.resolve({ id: "photo-1" }),
    });

    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, immutable");
    expect(response.headers.has("vary")).toBe(false);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain("inline");
  });

  it.each(["password", "members"] satisfies Visibility[])(
    "prevents shared caching of a %s-gated photograph",
    async (visibility) => {
      authz.requireVisitor.mockResolvedValue({ ok: true, visibility });

      const response = await getPhoto(new Request("https://archive.example/api/photos/photo-1"), {
        params: Promise.resolve({ id: "photo-1" }),
      });

      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("vary")).toBe("Cookie");
    },
  );

  it("never shares editor-only evidence even when the archive is public", async () => {
    store.getSiteVisibility.mockResolvedValue("public" satisfies Visibility);
    store.readAttachment.mockResolvedValue({
      metadata: { contentType: "application/pdf", filename: "source.pdf" },
      object: { body: "source", writeHttpMetadata: vi.fn() },
    });

    const response = await getPhoto(new Request("https://archive.example/api/photos/source-1"), {
      params: Promise.resolve({ id: "source-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("prevents an editor-only evidence denial from poisoning caches", async () => {
    store.getSiteVisibility.mockResolvedValue("public" satisfies Visibility);
    store.readAttachment.mockResolvedValue({
      metadata: { contentType: "application/pdf", filename: "source.pdf" },
      object: { body: "source", writeHttpMetadata: vi.fn() },
    });
    authz.requireEditor.mockResolvedValue({
      ok: false,
      response: new Response("Forbidden", { status: 403 }),
    });

    const response = await getPhoto(new Request("https://archive.example/api/photos/source-1"), {
      params: Promise.resolve({ id: "source-1" }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("does not expose SVG evidence as a public photograph", async () => {
    store.getSiteVisibility.mockResolvedValue("public" satisfies Visibility);
    store.readAttachment.mockResolvedValue({
      metadata: { contentType: "image/svg+xml", filename: "active.svg" },
      object: { body: "<svg />", writeHttpMetadata: vi.fn() },
    });
    authz.requireEditor.mockResolvedValue({
      ok: false,
      response: new Response("Forbidden", { status: 403 }),
    });

    const response = await getPhoto(new Request("https://archive.example/api/photos/active"), {
      params: Promise.resolve({ id: "active" }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("downloads authenticated evidence with sandbox and no sniffing", async () => {
    store.readAttachment.mockResolvedValue({
      metadata: { contentType: "text/html", filename: "source.html" },
      object: { body: "<script />", writeHttpMetadata: vi.fn() },
    });

    const response = await getFile(new Request("https://archive.example/api/files/source"), {
      params: Promise.resolve({ id: "source" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("prevents a missing-photo response from poisoning caches", async () => {
    store.readAttachment.mockResolvedValue(null);

    const response = await getPhoto(new Request("https://archive.example/api/photos/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});
