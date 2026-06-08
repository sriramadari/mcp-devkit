/**
 * client.ts — the TestClient: an ergonomic wrapper over the raw SDK Client.
 *
 * Everything a test reaches for, with the protocol boilerplate removed:
 *   - cached `tools()` / `resources()` / `prompts()` listings
 *   - `hasTool()`, `tool()` lookups
 *   - `call()` that optionally validates args against the tool's declared
 *     `inputSchema` *before* sending, so a bad call fails loudly in your test
 *     instead of silently in the server
 *   - `readResource()` / `getPrompt()` passthroughs
 *
 * Construct one with `createTestClient(target, options)`.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { openConnection } from "./connect";
import { validateAgainstSchema } from "./schema";
import type {
  ConnectOptions,
  ConnectTarget,
  PromptInfo,
  ResourceInfo,
  ToolInfo,
  ToolResult,
} from "./types";

export interface CallOptions {
  /**
   * Validate `args` against the tool's `inputSchema` before sending.
   * Default `true`. Throws a descriptive error if the args don't match.
   */
  validate?: boolean;
  /** Per-call timeout in ms (overrides the connection default). */
  timeoutMs?: number;
}

export class TestClient {
  /** The underlying SDK client — escape hatch for anything not wrapped here. */
  readonly raw: Client;
  private readonly _close: () => Promise<void>;
  private readonly defaultTimeoutMs: number;

  private _tools?: ToolInfo[];
  private _resources?: ResourceInfo[];
  private _prompts?: PromptInfo[];

  /** @internal — use {@link createTestClient}. */
  constructor(raw: Client, close: () => Promise<void>, defaultTimeoutMs: number) {
    this.raw = raw;
    this._close = close;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  // ── server identity / capabilities ─────────────────────────────────────────

  serverInfo(): { name: string; version: string } | undefined {
    return this.raw.getServerVersion() as { name: string; version: string } | undefined;
  }

  capabilities(): Record<string, unknown> | undefined {
    return this.raw.getServerCapabilities() as Record<string, unknown> | undefined;
  }

  // ── tools ───────────────────────────────────────────────────────────────────

  /** List the server's tools (cached after the first call — see {@link refresh}). */
  async tools(): Promise<ToolInfo[]> {
    if (!this._tools) {
      const res = await this.raw.listTools();
      this._tools = (res.tools ?? []) as ToolInfo[];
    }
    return this._tools;
  }

  async toolNames(): Promise<string[]> {
    return (await this.tools()).map((t) => t.name);
  }

  async hasTool(name: string): Promise<boolean> {
    return (await this.tools()).some((t) => t.name === name);
  }

  async tool(name: string): Promise<ToolInfo | undefined> {
    return (await this.tools()).find((t) => t.name === name);
  }

  /**
   * Call a tool. By default the args are validated against the tool's declared
   * `inputSchema` first; set `{ validate: false }` to send them as-is (e.g. to
   * test how the server handles bad input).
   */
  async call(
    name: string,
    args: Record<string, unknown> = {},
    options: CallOptions = {},
  ): Promise<ToolResult> {
    if (options.validate !== false) {
      const info = await this.tool(name);
      if (info?.inputSchema) {
        const { valid, errors } = validateAgainstSchema(args, info.inputSchema);
        if (!valid) {
          const detail = errors.map((e) => `  ${e.path} ${e.message}`).join("\n");
          throw new Error(`Arguments for tool "${name}" do not match its inputSchema:\n${detail}`);
        }
      }
    }
    const result = await this.raw.callTool(
      { name, arguments: args },
      undefined,
      { timeout: options.timeoutMs ?? this.defaultTimeoutMs },
    );
    return result as ToolResult;
  }

  // ── resources ─────────────────────────────────────────────────────────────

  async resources(): Promise<ResourceInfo[]> {
    if (!this._resources) {
      try {
        const res = await this.raw.listResources();
        this._resources = (res.resources ?? []) as ResourceInfo[];
      } catch {
        this._resources = []; // server doesn't advertise the resources capability
      }
    }
    return this._resources;
  }

  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }> }> {
    return (await this.raw.readResource({ uri })) as {
      contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
    };
  }

  // ── prompts ───────────────────────────────────────────────────────────────

  async prompts(): Promise<PromptInfo[]> {
    if (!this._prompts) {
      try {
        const res = await this.raw.listPrompts();
        this._prompts = (res.prompts ?? []) as PromptInfo[];
      } catch {
        this._prompts = [];
      }
    }
    return this._prompts;
  }

  async getPrompt(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.raw.getPrompt({ name, arguments: args as Record<string, string> });
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────

  /** Drop cached listings so the next `tools()`/`resources()`/`prompts()` re-fetches. */
  refresh(): void {
    this._tools = undefined;
    this._resources = undefined;
    this._prompts = undefined;
  }

  /** Liveness check — resolves if the server answers a ping. */
  async ping(): Promise<void> {
    await this.raw.ping();
  }

  /** Tear down the connection (and any spawned child process). Idempotent. */
  async close(): Promise<void> {
    await this._close();
  }
}

/**
 * Open a connection to an MCP server and return a ready-to-use {@link TestClient}.
 *
 * @example In-process (your own server):
 * ```ts
 * const client = await createTestClient({ server: buildMyServer() });
 * const res = await client.call("search", { q: "mcp" });
 * await client.close();
 * ```
 *
 * @example Over stdio (any server binary):
 * ```ts
 * const client = await createTestClient({ command: "node", args: ["dist/server.js"] });
 * ```
 */
export async function createTestClient(
  target: ConnectTarget,
  options: ConnectOptions = {},
): Promise<TestClient> {
  const { client, close } = await openConnection(target, options);
  return new TestClient(client, close, options.timeoutMs ?? 10_000);
}

/**
 * Run `fn` with a connected client and guarantee it's closed afterwards, even
 * if the test throws. Returns whatever `fn` returns.
 *
 * @example
 * ```ts
 * await withTestClient({ server }, async (client) => {
 *   expectToolResult(await client.call("ping")).toSucceed();
 * });
 * ```
 */
export async function withTestClient<T>(
  target: ConnectTarget,
  fn: (client: TestClient) => Promise<T>,
  options: ConnectOptions = {},
): Promise<T> {
  const client = await createTestClient(target, options);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}
