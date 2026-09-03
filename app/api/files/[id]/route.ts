import { requireEditor } from "../../../authz";
import { readAttachment } from "../../../../db/store";
import { preventSharedCaching, privateArchiveCacheHeaders } from "../../../../lib/archive-cache";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireEditor();
  if (!auth.ok) return preventSharedCaching(auth.response);
  const { id } = await context.params;
  const result = await readAttachment(id);
  if (!result) return preventSharedCaching(new Response("Not found", { status: 404 }));
  const headers = new Headers();
  result.object.writeHttpMetadata(headers);
  headers.set("content-type", result.metadata.contentType);
  headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.metadata.filename)}`);
  headers.set("content-security-policy", "sandbox");
  headers.set("x-content-type-options", "nosniff");
  for (const [name, value] of Object.entries(privateArchiveCacheHeaders())) headers.set(name, value);
  return new Response(result.object.body, { headers });
}
