/** Registration against the browser's WebMCP surface(s).
 *
 * The W3C draft and Chrome expose `navigator.modelContext`; some hosts (and
 * the WebMCP Challenge rules) name `document.modelContext`. Tools register on
 * whichever exist - both, when both do and they are distinct objects - so a
 * page works in every agentic browser without caring which shape shipped. */

export type BrowserToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
export type BrowserTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<BrowserToolResult>;
};

type ModelContext = {
  registerTool: (tool: BrowserTool) => void;
  unregisterTool: (name: string) => void;
};

function surfaces(): ModelContext[] {
  if (typeof window === "undefined") return [];
  const found: ModelContext[] = [];
  for (const host of [globalThis.navigator as unknown as Record<string, unknown>, globalThis.document as unknown as Record<string, unknown>]) {
    const candidate = host?.modelContext as ModelContext | undefined;
    if (candidate && typeof candidate.registerTool === "function" && !found.includes(candidate)) found.push(candidate);
  }
  return found;
}

export function webMcpAvailable(): boolean {
  return surfaces().length > 0;
}

/** Registers everywhere, returns the teardown. Tools must not outlive the
 * UI they drive, so call the teardown on unmount. */
export function registerBrowserTools(tools: BrowserTool[]): () => void {
  const contexts = surfaces();
  for (const context of contexts) {
    for (const tool of tools) context.registerTool(tool);
  }
  return () => {
    for (const context of contexts) {
      for (const tool of tools) {
        try { context.unregisterTool(tool.name); } catch { /* teardown races navigation */ }
      }
    }
  };
}
