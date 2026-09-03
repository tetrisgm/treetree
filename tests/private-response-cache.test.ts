import { describe, expect, it } from "vitest";
import { preventSharedCaching, privateJsonResponse } from "../lib/archive-cache";

describe("cookie-bound response cache policy", () => {
  it("marks JSON private, uncacheable, and cookie-varying", async () => {
    const response = privateJsonResponse({ account: "member@example.com" });

    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
    await expect(response.json()).resolves.toEqual({ account: "member@example.com" });
  });

  it("preserves existing vary dimensions and response metadata", () => {
    const response = preventSharedCaching(new Response(null, {
      status: 303,
      headers: {
        location: "/settings",
        vary: "Accept-Encoding",
        "set-cookie": "session=opaque; HttpOnly",
      },
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings");
    expect(response.headers.get("set-cookie")).toContain("session=opaque");
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Cookie");
  });

  it("does not duplicate Cookie when a response is protected twice", () => {
    const response = preventSharedCaching(preventSharedCaching(new Response("private")));

    expect(response.headers.get("vary")).toBe("Cookie");
  });
});
