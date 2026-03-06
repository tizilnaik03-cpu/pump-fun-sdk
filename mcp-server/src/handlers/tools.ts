import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerState } from "../types.js";
import { handleToolCall, TOOL_DEFINITIONS } from "../tools/index.js";

export function registerToolHandlers(
  server: Server,
  state: ServerState,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await handleToolCall(name, args ?? {}, state);
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  });
}
