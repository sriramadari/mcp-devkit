/**
 * types.ts — shared types for mcp-devkit.
 *
 * We intentionally keep our public surface decoupled from the exact shapes the
 * MCP SDK exports (those move between minor versions). Where we touch SDK data
 * we describe only the fields we read, structurally — so the kit keeps working
 * across a range of `@modelcontextprotocol/sdk` versions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** A single content block returned by a tool / prompt / resource read. */
export interface ContentBlock {
  type: string;
  /** Present on `type: "text"` blocks. */
  text?: string;
  /** Present on `type: "image"` / `"audio"` blocks. */
  data?: string;
  mimeType?: string;
  [k: string]: unknown;
}

/** The result of a `tools/call`, narrowed to the fields we read. */
export interface ToolResult {
  content: ContentBlock[];
  /** `true` when the tool reported a (non-protocol) execution error. */
  isError?: boolean;
  /** Structured payload, when the tool declares an `outputSchema`. */
  structuredContent?: unknown;
  [k: string]: unknown;
}

/** A tool descriptor as returned by `tools/list`. */
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A resource descriptor as returned by `resources/list`. */
export interface ResourceInfo {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  [k: string]: unknown;
}

/** A prompt descriptor as returned by `prompts/list`. */
export interface PromptInfo {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  [k: string]: unknown;
}

/**
 * The minimal subset of JSON Schema we understand for input validation.
 * Tools in the wild use far more, but this covers the cases worth checking
 * before a call leaves your test.
 */
export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  [k: string]: unknown;
}

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/**
 * What to connect a test client to. Exactly one of `server` | `command` must
 * be provided.
 *
 * - `server`: an already-constructed `McpServer` (or a factory returning one).
 *   Wired up over an in-process transport — fast, no child process, ideal for
 *   unit tests of your own server.
 * - `command` + `args`: a stdio MCP server launched as a child process — what
 *   you reach for in an end-to-end test or when inspecting a third-party
 *   server you don't import.
 */
export type ConnectTarget =
  | { server: McpServer | (() => McpServer | Promise<McpServer>); command?: never }
  | {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
      server?: never;
    };

export interface ConnectOptions {
  /** Client identity sent in the `initialize` handshake. */
  clientName?: string;
  clientVersion?: string;
  /** Per-request timeout in milliseconds (default 10_000). */
  timeoutMs?: number;
}
