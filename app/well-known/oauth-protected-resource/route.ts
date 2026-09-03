import { discoveryJson, discoveryOptions, protectedResourceMetadata } from "../../../lib/mcp-oauth";

export const runtime = "edge";
export const GET = () => discoveryJson(protectedResourceMetadata());
export const OPTIONS = discoveryOptions;
