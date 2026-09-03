// Zero-config discovery from the bare origin (the shape Notion serves).
import { archiveName, publicOrigin } from "../../../lib/archive-config";
import { discoveryJson, discoveryOptions } from "../../../lib/mcp-oauth";

export const runtime = "edge";
export const GET = () => discoveryJson({
  name: `${archiveName()} family archive`,
  description: "Query the family archive: people, relationships, stories, and how any two relatives connect.",
  endpoint: `${publicOrigin()}/api/mcp`,
});
export const OPTIONS = discoveryOptions;
