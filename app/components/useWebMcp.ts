"use client";

import { useEffect, useRef } from "react";
import type { FamilyTree } from "../../lib/types";
import { WEBMCP_TOOLS, type WebMcpActions } from "../../lib/webmcp-tools";

/** The WebMCP browser API (navigator.modelContext), shipping in Chrome/Edge
 * 2026. Typed narrowly here because @types/dom does not carry it yet. */
type ModelContextTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
};
type ModelContext = {
  registerTool: (tool: ModelContextTool) => void;
  unregisterTool: (name: string) => void;
};
function modelContext(): ModelContext | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  return candidate && typeof candidate.registerTool === "function" ? candidate : null;
}

/** Register the archive's tools with the browser's agent while this page is
 * mounted, and take them down on unmount so no tool outlives the UI it drives.
 * The live tree and actions are read through a ref, so a rebuilt tree does not
 * churn the registration - the tools always see the latest state. */
export function useWebMcp(tree: FamilyTree | null, actions: WebMcpActions, ready: boolean) {
  const latest = useRef({ tree, actions });
  // keep the ref current without writing it during render (a tool's execute,
  // fired by the browser agent, reads it long after this effect settles)
  useEffect(() => { latest.current = { tree, actions }; });

  useEffect(() => {
    const context = modelContext();
    if (!context || !ready) return;
    for (const tool of WEBMCP_TOOLS) {
      context.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (args) => {
          const { tree: liveTree, actions: liveActions } = latest.current;
          if (!liveTree) return { content: [{ type: "text", text: "The family tree has not finished loading yet; try again in a moment." }], isError: true };
          try {
            const text = await tool.execute(args ?? {}, liveTree, liveActions);
            return { content: [{ type: "text", text }] };
          } catch (error) {
            return { content: [{ type: "text", text: error instanceof Error ? error.message : "The tool call failed." }], isError: true };
          }
        },
      });
    }
    return () => {
      for (const tool of WEBMCP_TOOLS) {
        try { context.unregisterTool(tool.name); } catch { /* unmount races a navigation; nothing to clean up */ }
      }
    };
  }, [ready]);
}
