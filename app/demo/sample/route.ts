import { sampleGedcom } from "../../../lib/demo-family";

/** Public, bundled fiction only; never reads the archive database. */
export function GET() {
  return new Response(sampleGedcom, { headers: {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": 'attachment; filename="rowan-family.ged"',
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  } });
}
