"use client";

import { useEffect, useRef } from "react";
import type { FamilyTree } from "../../lib/types";
import { WEBMCP_TOOLS, type WebMcpActions } from "../../lib/webmcp-tools";
import { registerBrowserTools } from "../../lib/webmcp-register";

/** Register the archive's tools with the browser's agent while this page is
 * mounted, and take them down on unmount so no tool outlives the UI it drives.
 * The live tree and actions are read through a ref, so a rebuilt tree does not
 * churn the registration - the tools always see the latest state. */
export function useWebMcp(tree: FamilyTree | null, actions: WebMcpActions) {
  const latest = useRef({ tree, actions });
  // keep the ref current without writing it during render (a tool's execute,
  // fired by the browser agent, reads it long after this effect settles)
  useEffect(() => { latest.current = { tree, actions }; });

  // register at mount, not at tree-ready: an agent may enumerate the page's
  // tools immediately, and execute() already answers "still loading" politely
  useEffect(() => {
    return registerBrowserTools(WEBMCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args) => {
        const { tree: liveTree, actions: liveActions } = latest.current;
        if (!liveTree) return { content: [{ type: "text" as const, text: "The family tree has not finished loading yet; try again in a moment." }], isError: true };
        try {
          const text = await tool.execute(args ?? {}, liveTree, liveActions);
          return { content: [{ type: "text" as const, text }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "The tool call failed." }], isError: true };
        }
      },
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
