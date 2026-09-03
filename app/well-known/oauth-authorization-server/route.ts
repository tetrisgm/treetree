import { authorizationServerMetadata, discoveryJson, discoveryOptions } from "../../../lib/mcp-oauth";

export const runtime = "edge";
export const GET = () => discoveryJson(authorizationServerMetadata());
export const OPTIONS = discoveryOptions;
