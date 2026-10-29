// A minimal MCP server over stdio, spawned by stdio.test.ts.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "stdio-fixture", version: "1.0.0" });
server.registerTool("ping", { description: "Reply with pong" }, async () => ({
  content: [{ type: "text", text: "pong" }],
}));
await server.connect(new StdioServerTransport());
