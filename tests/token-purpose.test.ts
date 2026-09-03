import { Buffer } from "node:buffer";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const cookieState = vi.hoisted(() => ({ values: new Map<string, string>() }));
const store = vi.hoisted(() => ({
  getMemberRole: vi.fn(),
  getSiteVisibility: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieState.values.get(name);
      return value ? { value } : undefined;
    },
  })),
}));
vi.mock("../db/store", () => store);

import {
  createSession,
  getAppleUser,
  signToken,
  verifyArchiveAccessToken,
  verifyToken,
} from "../app/apple-auth";
import { hasAccessPass } from "../app/authz";

const originalSecret = process.env.AUTH_SESSION_SECRET;
const testSecret = "token-purpose-unit-test-secret";

async function legacyToken(payload: Record<string, unknown>): Promise<string> {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(testSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${Buffer.from(signature).toString("base64url")}`;
}

beforeEach(() => {
  process.env.AUTH_SESSION_SECRET = testSecret;
  cookieState.values.clear();
  vi.clearAllMocks();
});

afterAll(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SESSION_SECRET;
  else process.env.AUTH_SESSION_SECRET = originalSecret;
});

describe("signed token purposes", () => {
  it("does not accept a member session copied into the archive-access cookie", async () => {
    const session = await createSession({
      subject: "apple:person-1",
      email: "person@example.com",
      displayName: "Person",
    });
    cookieState.values.set("archive_access", session);

    await expect(hasAccessPass()).resolves.toBe(false);
    await expect(verifyArchiveAccessToken(session)).resolves.toBe(false);
  });

  it("accepts only a true access claim with the matching purpose", async () => {
    const expires = Math.floor(Date.now() / 1000) + 60;
    const granted = await signToken({ access: true, exp: expires }, "archive-access");
    const denied = await signToken({ access: false, exp: expires }, "archive-access");

    await expect(verifyArchiveAccessToken(granted)).resolves.toBe(true);
    await expect(verifyArchiveAccessToken(denied)).resolves.toBe(false);
    await expect(verifyToken(granted, "session")).resolves.toBeNull();
    await expect(verifyToken(granted, "archive-access")).resolves.not.toBeNull();
  });

  it("keeps exact legacy access cookies working without accepting identity claims", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const access = await legacyToken({ access: true, exp });
    const mixed = await legacyToken({
      access: true,
      subject: "person-1",
      email: "person@example.com",
      displayName: "Person",
      exp,
    });

    await expect(verifyArchiveAccessToken(access)).resolves.toBe(true);
    await expect(verifyArchiveAccessToken(mixed)).resolves.toBe(false);
  });

  it("keeps exact legacy sessions working while rejecting access-shaped cookies", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const session = await legacyToken({
      subject: "apple:person-1",
      email: "person@example.com",
      displayName: "Person",
      exp,
    });
    cookieState.values.set("archive_session", session);

    await expect(getAppleUser()).resolves.toEqual({
      subject: "apple:person-1",
      email: "person@example.com",
      displayName: "Person",
    });

    cookieState.values.set("archive_session", await legacyToken({ access: true, exp }));
    await expect(getAppleUser()).resolves.toBeNull();
  });
});
