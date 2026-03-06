import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_VERSION, type ServerState } from "./types.js";
import { registerToolHandlers } from "./handlers/tools.js";
import { registerResourceHandlers } from "./handlers/resources.js";
import { registerPromptHandlers } from "./handlers/prompts.js";

export class SolanaWalletMCPServer {
  private server: Server;
  private state: ServerState;

  constructor() {
    this.state = {
      initialized: false,
      generatedKeypairs: new Map(),
    };

    this.server = new Server(
      {
        name: "pump-fun-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: false, listChanged: true },
          prompts: { listChanged: true },
        },
      },
    );

    this.registerHandlers();
    this.setupErrorHandling();
  }

  private registerHandlers(): void {
    registerToolHandlers(this.server, this.state);
    registerResourceHandlers(this.server, this.state);
    registerPromptHandlers(this.server, this.state);
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.shutdown();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await this.shutdown();
      process.exit(0);
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.state.initialized = true;

    // Log to stderr — stdout is reserved for MCP JSON-RPC
    console.error("Pump Fun MCP Server started");
    console.error(`Protocol version: ${MCP_VERSION}`);
  }

  async shutdown(): Promise<void> {
    // Zeroize sensitive data
    for (const [, keypair] of this.state.generatedKeypairs) {
      keypair.secretKey.fill(0);
    }
    this.state.generatedKeypairs.clear();
    console.error("Pump Fun MCP Server shutdown — keys zeroized");
  }

  getState(): ServerState {
    return this.state;
  }
}

export function createServer(): SolanaWalletMCPServer {
  return new SolanaWalletMCPServer();
}
