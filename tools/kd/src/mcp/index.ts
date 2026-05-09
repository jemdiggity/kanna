import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpToolDefinitions, executeMcpTool } from "./tool-registry";

export async function createKdMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "kd",
    version: "0.0.0",
    description: "Kanna self-development workflow server. Tools mirror kd CLI tasks for dev, mobile, emulator, and doctor workflows."
  });

  for (const tool of buildMcpToolDefinitions()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema
      },
      async (args) => {
        const result = await executeMcpTool({
          name: tool.name,
          arguments: args,
          cwd: process.cwd(),
          env: process.env
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ],
          isError: !result.ok
        };
      }
    );
  }

  return server;
}

export async function startKdMcpServer(): Promise<void> {
  const server = await createKdMcpServer();
  await server.connect(new StdioServerTransport());
}
