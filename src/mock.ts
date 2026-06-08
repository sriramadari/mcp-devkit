/**
 * mock.ts — build throwaway `McpServer` fixtures for tests.
 *
 * `createTestClient({ server })` needs *a* server to talk to. Often that's the
 * real one you're testing — but when you're testing the kit itself, or want a
 * controlled server to assert client behaviour against, `mockServer()` spins
 * one up in a few lines.
 *
 * Tool handlers return either a string (wrapped as a single text block) or a
 * partial tool result. Input schemas are passed straight through to the SDK's
 * `registerTool`, so they accept a Zod raw-shape (e.g. `{ q: z.string() }`) —
 * we never import Zod ourselves, keeping the kit dependency-free at runtime.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ContentBlock } from "./types";

export type MockToolReturn =
  | string
  | {
      content?: ContentBlock[];
      isError?: boolean;
      structuredContent?: unknown;
    };

export interface MockToolSpec {
  name: string;
  description?: string;
  title?: string;
  /**
   * A Zod raw-shape describing the arguments, e.g. `{ q: z.string() }`.
   * Passed verbatim to `McpServer.registerTool`. Omit for a zero-arg tool.
   */
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  /** Runs when the tool is called. May be async. */
  handler: (args: Record<string, unknown>) => MockToolReturn | Promise<MockToolReturn>;
}

export interface MockServerSpec {
  name?: string;
  version?: string;
  tools?: MockToolSpec[];
}

function normalize(ret: MockToolReturn): { content: ContentBlock[]; isError?: boolean; structuredContent?: unknown } {
  if (typeof ret === "string") {
    return { content: [{ type: "text", text: ret }] };
  }
  return {
    content: ret.content ?? [{ type: "text", text: "" }],
    isError: ret.isError,
    structuredContent: ret.structuredContent,
  };
}

/**
 * Build an `McpServer` from a compact spec — ready to hand to
 * `createTestClient({ server })`.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * const server = mockServer({
 *   name: "demo",
 *   tools: [{
 *     name: "echo",
 *     description: "Echo the message back",
 *     inputSchema: { message: z.string() },
 *     handler: ({ message }) => `you said: ${message}`,
 *   }],
 * });
 * ```
 */
export function mockServer(spec: MockServerSpec = {}): McpServer {
  const server = new McpServer(
    { name: spec.name ?? "mock-server", version: spec.version ?? "0.0.0" },
    { capabilities: { tools: {} } },
  );

  for (const tool of spec.tools ?? []) {
    const config: Record<string, unknown> = {};
    if (tool.description) config.description = tool.description;
    if (tool.title) config.title = tool.title;
    if (tool.inputSchema) config.inputSchema = tool.inputSchema;
    if (tool.annotations) config.annotations = tool.annotations;

    // The SDK's callback receives parsed args (when inputSchema is set) plus an
    // `extra` we don't need here. We funnel both arg-shapes into our handler.
    const cb = async (argsOrExtra: unknown) => {
      const args = (tool.inputSchema ? (argsOrExtra as Record<string, unknown>) : {}) ?? {};
      return normalize(await tool.handler(args));
    };

    // registerTool's overloads are tighter than our pass-through types; the
    // cast is intentional and safe — the SDK validates the config at runtime.
    (server.registerTool as unknown as (n: string, c: unknown, cb: unknown) => unknown)(
      tool.name,
      config,
      cb,
    );
  }

  return server;
}
