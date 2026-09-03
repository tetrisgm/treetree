import type { FamilyTree } from "./types";

export const TREE_SNAPSHOT_OBJECT_KEY = "system/tree-snapshot.json";
export const VISIBILITY_SNAPSHOT_OBJECT_KEY = "system/site-visibility.txt";
export const MEMBERS_SNAPSHOT_OBJECT_KEY = "system/members.json";

export type MemberAccessSnapshot = {
  members: { email: string; role: "admin" | "canEdit" | "canView"; personId: string | null }[];
  links: { email: string; memberEmail: string; provider: string | null }[];
};

export function isD1DailyReadLimitError(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate; depth += 1) {
    const message = (candidate instanceof Error ? candidate.message : String(candidate)).toLowerCase();
    if (message.includes("d1") && message.includes("daily row read limit")) return true;
    candidate = candidate instanceof Error ? candidate.cause : null;
  }
  return false;
}

export function nextUtcMidnight(timestamp = Date.now()): number {
  const now = new Date(timestamp);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

/** Tolerates surrounding whitespace: the object may be seeded by hand, and a
 * shell-added trailing newline once made every quota-fallback read throw. */
export function parseVisibilitySnapshot(value: string): "public" | "members" | "password" | null {
  const trimmed = value.trim();
  return trimmed === "public" || trimmed === "members" || trimmed === "password" ? trimmed : null;
}

export function parseMemberAccessSnapshot(value: string): MemberAccessSnapshot | null {
  try {
    const parsed = JSON.parse(value) as Partial<MemberAccessSnapshot>;
    if (!Array.isArray(parsed.members) || !Array.isArray(parsed.links)) return null;
    return parsed as MemberAccessSnapshot;
  } catch {
    return null;
  }
}

export function parseTreeSnapshot(value: string): FamilyTree | null {
  try {
    const parsed = JSON.parse(value) as Partial<FamilyTree>;
    if (!Array.isArray(parsed.people) || !Array.isArray(parsed.relationships) || !Array.isArray(parsed.stories)) return null;
    return parsed as FamilyTree;
  } catch {
    return null;
  }
}
