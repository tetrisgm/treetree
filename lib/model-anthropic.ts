/** Anthropic's Messages API, wearing the shape the archivist already speaks.
 *
 * The three routes that call a model were written against OpenAI's Responses
 * API - instructions, an input list, function tools, and an output array of
 * function calls. Rather than rewrite them per provider, this adapter
 * translates that request into a Messages call and translates the reply back,
 * so `lib/model.ts` can hand either provider to the same code.
 *
 * Written on fetch rather than an SDK: the Worker bundle stays small, and the
 * slice of the API in use here is four fields wide. Conversion is pure and
 * unit-tested; only `createMessage` touches the network.
 */

const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

type ResponsesInputItem = { role: string; content: unknown };
export type ResponsesRequest = {
  model: string;
  instructions?: string;
  input: string | ResponsesInputItem[];
  tools?: unknown[];
  max_output_tokens?: number;
  [key: string]: unknown;
};
export type ResponsesLikeOutput =
  | { type: "function_call"; name: string; arguments: string; call_id: string }
  | { type: "message"; content: { type: "output_text"; text: string }[] };
export type ResponsesLikeResponse = { output: ResponsesLikeOutput[]; output_text: string };

type Block = Record<string, unknown>;

const dataUrlParts = (value: string) => {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value);
  return match ? { mediaType: match[1], data: match[2] } : null;
};

/** one OpenAI content part -> one Anthropic block (unknown parts are dropped) */
function contentBlock(part: Record<string, unknown>): Block | null {
  if (part.type === "input_text" || part.type === "text") return { type: "text", text: String(part.text ?? "") };
  if (part.type === "input_image") {
    const parts = dataUrlParts(String(part.image_url ?? ""));
    return parts
      ? { type: "image", source: { type: "base64", media_type: parts.mediaType, data: parts.data } }
      : { type: "image", source: { type: "url", url: String(part.image_url ?? "") } };
  }
  if (part.type === "input_file") {
    const parts = dataUrlParts(String(part.file_data ?? ""));
    // Anthropic reads PDFs as documents; anything else arrives as its text
    if (parts?.mediaType === "application/pdf") return { type: "document", source: { type: "base64", media_type: parts.mediaType, data: parts.data } };
    if (parts) return { type: "text", text: `Attached file ${String(part.filename ?? "")} (${parts.mediaType}); its contents could not be read directly.` };
    return null;
  }
  return null;
}

export function toMessagesRequest(request: ResponsesRequest, model: string): Record<string, unknown> {
  const messages = typeof request.input === "string"
    ? [{ role: "user", content: [{ type: "text", text: request.input }] }]
    : request.input.map((item) => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: Array.isArray(item.content)
          ? (item.content as Record<string, unknown>[]).map(contentBlock).filter((block): block is Block => Boolean(block))
          : [{ type: "text", text: String(item.content ?? "") }],
      })).filter((message) => (message.content as unknown[]).length > 0);
  const tools = (request.tools ?? [])
    .map((tool) => tool as { type?: string; name?: string; description?: string; parameters?: unknown })
    .filter((tool) => tool.type === "function" && tool.name)
    .map((tool) => ({ name: tool.name, description: tool.description ?? "", input_schema: tool.parameters ?? { type: "object", properties: {} } }));
  return {
    model,
    // Messages requires a token ceiling; the archivist's replies are short,
    // and a document read with many tool calls is the widest case
    max_tokens: request.max_output_tokens ?? 8192,
    ...(request.instructions ? { system: request.instructions } : {}),
    messages: messages.length ? messages : [{ role: "user", content: [{ type: "text", text: "" }] }],
    ...(tools.length ? { tools } : {}),
  };
}

export function fromMessagesResponse(body: { content?: unknown[] }): ResponsesLikeResponse {
  const blocks = Array.isArray(body.content) ? body.content as Record<string, unknown>[] : [];
  const output: ResponsesLikeOutput[] = [];
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") { texts.push(String(block.text ?? "")); continue; }
    if (block.type === "tool_use") {
      output.push({ type: "function_call", name: String(block.name ?? ""), arguments: JSON.stringify(block.input ?? {}), call_id: String(block.id ?? "") });
    }
  }
  const text = texts.join("\n").trim();
  if (text) output.push({ type: "message", content: [{ type: "output_text", text }] });
  return { output, output_text: text };
}

/** the small slice of the OpenAI client surface the routes actually use */
export function anthropicResponsesClient(apiKey: string, model: string) {
  return {
    responses: {
      create: async (request: ResponsesRequest, options?: { timeout?: number }): Promise<ResponsesLikeResponse> => {
        const controller = new AbortController();
        const timer = options?.timeout ? setTimeout(() => controller.abort(), options.timeout) : null;
        try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
            body: JSON.stringify(toMessagesRequest(request, model)),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`anthropic_${response.status}`);
          return fromMessagesResponse(await response.json() as { content?: unknown[] });
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
    },
  };
}
