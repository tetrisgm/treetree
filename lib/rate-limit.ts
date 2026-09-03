import { consumeRateLimit } from "../db/store";

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function limitRequest(request: Request, scope: string, limit: number, windowSeconds: number): Promise<Response | null> {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";
  const fingerprint = await sha256(`${scope}\0${address}`);
  const result = await consumeRateLimit(`${scope}:${fingerprint}`, limit, windowSeconds);
  return result.allowed ? null : Response.json({ error: "rate_limited", retryAfter: result.retryAfter }, {
    status: 429, headers: { "retry-after": String(result.retryAfter), "cache-control": "private, no-store" },
  });
}
