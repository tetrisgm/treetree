// RFC 9728 path-suffixed form: spec-following clients construct
// /.well-known/oauth-protected-resource/api/mcp themselves.
import { discoveryJson, discoveryOptions, protectedResourceMetadata } from "../../../../../lib/mcp-oauth";

export const runtime = "edge";
export const GET = () => discoveryJson(protectedResourceMetadata());
export const OPTIONS = discoveryOptions;
