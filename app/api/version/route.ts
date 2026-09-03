import { BUILD_ID, DEPLOYED_AT, VERSION } from "../../../lib/build";

export const runtime = "edge";

export function GET() {
  return Response.json({ version: VERSION, build: BUILD_ID, deployedAt: DEPLOYED_AT }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
