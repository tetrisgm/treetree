import { describe, expect, it } from "vitest";
import { fromMessagesResponse, toMessagesRequest } from "../lib/model-anthropic";

describe("the Anthropic adapter", () => {
  it("turns an archivist request into a Messages call", () => {
    const request = toMessagesRequest({
      model: "ignored",
      instructions: "You are the archivist.",
      input: [{ role: "user", content: [
        { type: "input_text", text: "Read this." },
        { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "high" },
        { type: "input_file", filename: "will.pdf", file_data: "data:application/pdf;base64,BBBB" },
      ] }],
      tools: [{ type: "function", name: "propose_add_person", description: "Add someone", parameters: { type: "object", properties: {} } }, { type: "other" }],
    }, "claude-opus-5");
    expect(request.model).toBe("claude-opus-5");
    expect(request.system).toBe("You are the archivist.");
    expect(request.max_tokens).toBe(8192);
    const content = (request.messages as { content: Record<string, unknown>[] }[])[0].content;
    expect(content.map((block) => block.type)).toEqual(["text", "image", "document"]);
    expect((content[1].source as Record<string, string>).data).toBe("AAAA");
    expect(request.tools).toEqual([{ name: "propose_add_person", description: "Add someone", input_schema: { type: "object", properties: {} } }]);
  });
  it("keeps a plain string question a plain question", () => {
    const request = toMessagesRequest({ model: "x", input: "Who was Bahram?", max_output_tokens: 400 }, "claude-opus-5");
    expect(request.max_tokens).toBe(400);
    expect(request.system).toBeUndefined();
    expect(request.tools).toBeUndefined();
    expect(request.messages).toEqual([{ role: "user", content: [{ type: "text", text: "Who was Bahram?" }] }]);
  });
  it("returns tool calls and prose in the shape the routes read", () => {
    const reply = fromMessagesResponse({ content: [
      { type: "text", text: "I found two people." },
      { type: "tool_use", id: "toolu_1", name: "propose_add_person", input: { summary: "Add Bahram" } },
    ] });
    expect(reply.output_text).toBe("I found two people.");
    const call = reply.output.find((item) => item.type === "function_call");
    expect(call).toMatchObject({ type: "function_call", name: "propose_add_person", call_id: "toolu_1" });
    expect(JSON.parse((call as { arguments: string }).arguments)).toEqual({ summary: "Add Bahram" });
  });
  it("survives a reply with no text and no tools", () => {
    expect(fromMessagesResponse({})).toEqual({ output: [], output_text: "" });
  });
});

describe("documents the archivist is sent", () => {
  it("passes a text file through as its text, not as its filename", () => {
    const csv = Buffer.from("name,born\nBahram,1900\n", "utf8").toString("base64");
    const request = toMessagesRequest({
      model: "x",
      input: [{ role: "user", content: [{ type: "input_file", filename: "family.csv", file_data: `data:text/csv;base64,${csv}` }] }],
    }, "claude-opus-5");
    const block = (request.messages as { content: Record<string, string>[] }[])[0].content[0];
    expect(block.type).toBe("text");
    expect(block.text).toContain("Bahram,1900");
  });
  it("says so plainly when a format cannot be read", () => {
    const request = toMessagesRequest({
      model: "x",
      input: [{ role: "user", content: [{ type: "input_file", filename: "scan.tiff", file_data: "data:image/tiff;base64,AAAA" }] }],
    }, "claude-opus-5");
    const block = (request.messages as { content: Record<string, string>[] }[])[0].content[0];
    expect(block.text).toContain("cannot be read directly");
  });
});
