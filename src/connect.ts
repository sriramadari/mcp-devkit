/**
 * connect.ts — establish a live MCP client connection to a target.
 *
 * Two transports, one entry point:
 *   - in-process (`InMemoryTransport.createLinkedPair`) for an `McpServer` you
 *     constructed in the same test, and
 *   - stdio (`StdioClientTransport`) for a server you launch as a child process.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ConnectOptions, ConnectTarget } from "./types";

export interface Connection {
  client: Client;
  /** Tears down the client, the transport, and any spawned child process. */
  close: () => Promise<void>;
}

export async function openConnection(
  target: ConnectTarget,
  options: ConnectOptions = {},
): Promise<Connection> {
  const client = new Client({
    name: options.clientName ?? "mcp-devkit",
    version: options.clientVersion ?? "0.1.0",
  });

  if ("server" in target && target.server) {
    const server = typeof target.server === "function" ? await target.server() : target.server;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // Connect the server first so it's listening before the client handshakes.
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return {
      client,
      close: async () => {
        await client.close().catch(() => {});
        await server.close().catch(() => {});
      },
    };
  }

  if ("command" in target && target.command) {
    const transport = new StdioClientTransport({
      command: target.command,
      args: target.args ?? [],
      env: target.env,
      cwd: target.cwd,
    });
    await client.connect(transport);
    return {
      client,
      // Closing the client closes the transport, which terminates the child.
      close: async () => {
        await client.close().catch(() => {});
      },
    };
  }

  throw new Error("openConnection: target must provide either `server` or `command`");
}
