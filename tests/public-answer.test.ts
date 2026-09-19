import { describe, expect, it, vi } from "vitest";
import { requestPublicAnswer } from "../lib/public-answer";

describe("public chat failures", () => {
  it("sends the question and returns a successful answer", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ reply: "June is Maya's granddaughter." }));
    expect(await requestPublicAnswer("How are they related?", request)).toBe("June is Maya's granddaughter.");
    expect(request).toHaveBeenCalledWith("/api/ask", expect.objectContaining({ method: "POST", body: JSON.stringify({ message: "How are they related?" }) }));
  });
  it.each([429, 503, 500])("explains HTTP %s even when the response is HTML", async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Error</html>", { status }));
    const answer = await requestPublicAnswer("Question", request);
    expect(answer).toMatch(status === 429 ? /request limit/ : status === 503 ? /unavailable/ : /try again/);
    expect(answer).not.toContain("<html>");
  });
  it("handles an interrupted connection and malformed responses without rejecting", async () => {
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await requestPublicAnswer("Question", offline)).toContain("connection");
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response("not JSON"));
    expect(await requestPublicAnswer("Question", malformed)).toContain("try again");
    const empty = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ reply: 42 }));
    expect(await requestPublicAnswer("Question", empty)).toContain("no answer");
  });
});
