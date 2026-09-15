import { describe, expect, it } from "vitest";
import { GET } from "../app/api/auth/signout/route";

describe("signing out", () => {
  it("redirects home and clears the session", async () => {
    const response = await GET(new Request("https://archive.example/api/auth/signout?return_to=%2F"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://archive.example/");
    // the cookie is emptied and expired, or the reader stays signed in
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^[a-z_]+=;/i);
    expect(cookie.toLowerCase()).toContain("max-age=0");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("returns only to somewhere in this archive", async () => {
    const away = await GET(new Request("https://archive.example/api/auth/signout?return_to=https%3A%2F%2Felsewhere.example%2Fsteal"));
    expect(away.headers.get("location")).toBe("https://archive.example/");
    const protocolRelative = await GET(new Request("https://archive.example/api/auth/signout?return_to=%2F%2Felsewhere.example"));
    expect(protocolRelative.headers.get("location")).toBe("https://archive.example/");
  });
  it("keeps the page it was asked to return to", async () => {
    const response = await GET(new Request("https://archive.example/api/auth/signout?return_to=%2Fsettings"));
    expect(response.headers.get("location")).toBe("https://archive.example/settings");
  });
});
