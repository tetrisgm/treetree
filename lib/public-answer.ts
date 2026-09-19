/** A failed request must leave the public chat with an explanation, not a
 * rejected event handler and an empty answer. */
export async function requestPublicAnswer(message: string, request: typeof fetch = fetch): Promise<string> {
  try {
    const response = await request("/api/ask", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
    });
    if (response.status === 429) return "The archivist has reached its request limit. Please try again later; you can still explore the tree and the sandbox.";
    if (response.status === 503) return "AI chat is unavailable on this archive right now. You can still explore the records and try the sandbox.";
    if (!response.ok) return "The archivist could not answer right now. Please try again.";
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "reply" in data && typeof data.reply === "string" && data.reply.trim()) return data.reply;
    return "The archivist returned no answer. Please try again.";
  } catch {
    return "The connection to the archivist was interrupted. Please try again.";
  }
}
