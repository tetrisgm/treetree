import { requireEditor } from "../../authz";
import { addRelationship, applyProposal, attachPersonPhoto, linkPersonPhoto, readTree, removePerson, removePersonPhoto, removeRelationship, setPersonPortrait, setRelationshipStatus, unlinkPersonPhoto, updatePerson } from "../../../db/store";
import { isPublicRasterContentType, safeAttachmentContentType } from "../../../lib/attachment-types";

export const runtime = "edge";
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await requireEditor();
  if (!auth.ok) return auth.response;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const personId = String(form.get("personId") ?? "");
      const file = form.get("photo");
      if (!personId || !(file instanceof File)) {
        return Response.json({ error: "invalid_photo" }, { status: 400 });
      }
      if (file.size > MAX_PHOTO_BYTES) return Response.json({ error: "photo_too_large" }, { status: 413 });
      const contentType = safeAttachmentContentType(new Uint8Array(await file.slice(0, 16).arrayBuffer()), file.type);
      if (!isPublicRasterContentType(contentType)) return Response.json({ error: "invalid_photo" }, { status: 400 });
      return Response.json({ ok: true, tree: await attachPersonPhoto(personId, file, auth.user.email) });
    }
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "update") {
      return Response.json({ ok: true, tree: await updatePerson(String(body.personId ?? ""), (body.patch ?? {}) as Record<string, unknown>, auth.user.email) });
    }
    if (action === "remove") return Response.json({ ok: true, tree: await removePerson(String(body.personId ?? ""), auth.user.email) });
    if (action === "merge") return Response.json({ ok: true, tree: await applyProposal({
      kind: "merge_people", summary: String(body.summary ?? "Merged duplicate family records"),
      sourcePersonId: String(body.sourcePersonId ?? ""), targetPersonId: String(body.targetPersonId ?? ""),
    }, auth.user.email) });
    if (action === "remove_relationship") return Response.json({ ok: true, tree: await removeRelationship(String(body.relationshipId ?? ""), auth.user.email) });
    if (action === "relationship_status") {
      const status = typeof body.status === "string" && ["divorced", "widowed"].includes(body.status) ? body.status : null;
      return Response.json({ ok: true, tree: await setRelationshipStatus(String(body.relationshipId ?? ""), status, auth.user.email) });
    }
    if (action === "remove_photo") return Response.json({ ok: true, tree: await removePersonPhoto(String(body.personId ?? ""), auth.user.email) });
    if (action === "set_portrait") return Response.json({ ok: true, tree: await setPersonPortrait(String(body.personId ?? ""), body.attachmentId ? String(body.attachmentId) : null, auth.user.email) });
    if (action === "link_photo") return Response.json({ ok: true, tree: await linkPersonPhoto(String(body.personId ?? ""), String(body.attachmentId ?? ""), auth.user.email) });
    if (action === "unlink_photo") return Response.json({ ok: true, tree: await unlinkPersonPhoto(String(body.personId ?? ""), String(body.attachmentId ?? ""), auth.user.email) });
    if (action === "add") {
      const displayName = String(body.displayName ?? "").trim();
      if (!displayName) return Response.json({ error: "display_name_required" }, { status: 400 });
      const text = (key: string) => {
        const value = body[key];
        return typeof value === "string" && value.trim() ? value.trim() : null;
      };
      return Response.json({ ok: true, tree: await applyProposal({ kind: "add_person", summary: "Added a family member", person: { displayName, gender: body.gender === "male" || body.gender === "female" ? body.gender : null, givenName: null, familyName: null, maidenName: null, birthDate: text("birthDate"), deathDate: text("deathDate"), birthPlace: null, deathPlace: null, birthCity: text("birthCity"), birthCountry: text("birthCountry"), deathCity: text("deathCity"), deathCountry: text("deathCountry"), burialPlace: null, residence: text("residence"), biography: text("biography"), photoAttachmentId: null } }, auth.user.email) });
    }
    if (action === "relationship") {
      const relationshipType = body.relationshipType === "spouse" ? "spouse" : "parent";
      return Response.json({ ok: true, tree: await addRelationship(String(body.fromPersonId ?? ""), String(body.toPersonId ?? ""), relationshipType, auth.user.email) });
    }
    if (action === "tree") return Response.json({ ok: true, tree: await readTree() });
    return Response.json({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "people_update_failed" }, { status: 400 });
  }
}
