# mcp-devkit

A **zero-dependency testing & inspection toolkit for [Model Context Protocol](https://modelcontextprotocol.io) servers** — the things you reach for when you want to actually *test* an MCP server instead of clicking around an inspector:

- 🔌 **In-memory & stdio test clients** — connect to an `McpServer` you built (no child process, no network) or launch any server binary over stdio
- ✅ **Fluent, framework-agnostic assertions** — `expectToolResult(res).toSucceed().toHaveText(/…/).toMatchStructured({…})` — works in vitest, jest, or `node:test`
- 🛡️ **Client-side input validation** — bad arguments fail loudly in your test (against the tool's own `inputSchema`) instead of silently in the server
- 🧪 **Automated conformance checker** — catches the mistakes that make a server hard for an LLM to use: missing descriptions, malformed schemas, duplicate/illegal tool names, a server that crashes on an unknown tool
- 🔎 **A CLI** — `inspect`, `check`, and `call` any stdio MCP server without writing a script

The only runtime peer dependency is the MCP SDK itself.

```bash
npm install -D mcp-devkit
# the MCP SDK is a peer dependency — install it if you haven't:
npm install @modelcontextprotocol/sdk
```

> Requires Node ≥ 18 and `@modelcontextprotocol/sdk` ≥ 1.10. ESM + CJS, fully typed.

---

## Testing your own server (in-memory)

No child process, no ports — the client and server talk over an in-process transport.

```ts
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { createTestClient, expectToolResult, conformanceCheck } from "mcp-devkit";
import { buildMyServer } from "../src/server"; // returns an McpServer

let client;
beforeAll(async () => { client = await createTestClient({ server: buildMyServer() }); });
afterAll(async () => { await client.close(); });

it("returns a forecast", async () => {
  const res = await client.call("get_forecast", { city: "Paris", days: 3 });
  expectToolResult(res)
    .toSucceed()
    .toHaveText(/Paris/)
    .toMatchStructured({ city: "Paris", summary: "sunny" });
});

it("is well-formed", async () => {
  expect((await conformanceCheck(client)).ok).toBe(true);
});
```

`{ server }` also accepts a **factory** (`() => McpServer | Promise<McpServer>`) so each test gets a fresh instance.

Prefer automatic cleanup? Use `withTestClient`, which always closes — even if the body throws:

```ts
import { withTestClient, expectToolResult } from "mcp-devkit";

await withTestClient({ server: buildMyServer() }, async (client) => {
  expectToolResult(await client.call("ping")).toSucceed();
});
```

## Testing a server over stdio

Point the client at a command; it's spawned as a child process and torn down on `close()`.

```ts
const client = await createTestClient({
  command: "node",
  args: ["dist/server.js"],
  // env, cwd also supported
});
```

---

## The CLI

Everything after `--` is the MCP server command to launch over stdio.

```bash
# Dump tools / resources / prompts (add --json for machine output)
npx mcp-devkit inspect -- node dist/server.js

# Run the conformance battery (exit code 1 if an error-severity check fails)
npx mcp-devkit check -- npx -y @modelcontextprotocol/server-everything

# Call a single tool
npx mcp-devkit call --tool search --args '{"q":"mcp"}' -- node dist/server.js
```

`check` output:

```
✓ Server reports a name and version
✓ tools/list responds  — 4 tool(s)
✓ Tool names are unique
✓ Tool names use a safe charset and length
! Every tool has a description  — an LLM picks tools by their description
    • legacy_export
✓ Calling an unknown tool fails gracefully (no crash/hang)

FAIL  6 passed, 1 failed, 0 skipped
```

---

## API

### `createTestClient(target, options?) → Promise<TestClient>`

`target` is `{ server }` (in-memory) or `{ command, args?, env?, cwd? }` (stdio).
`options`: `{ clientName?, clientVersion?, timeoutMs? }` (default timeout 10s).

#### `TestClient`

| Method | Description |
| --- | --- |
| `tools()` / `toolNames()` | List tools (cached; `refresh()` to re-fetch) |
| `hasTool(name)` / `tool(name)` | Lookup helpers |
| `call(name, args?, opts?)` | Call a tool. Validates `args` against the tool's `inputSchema` by default — pass `{ validate: false }` to skip, `{ timeoutMs }` to override |
| `resources()` / `readResource(uri)` | Resources (empty list if unsupported) |
| `prompts()` / `getPrompt(name, args?)` | Prompts (empty list if unsupported) |
| `serverInfo()` / `capabilities()` | Server identity & advertised capabilities |
| `ping()` | Liveness check |
| `raw` | The underlying SDK `Client` — escape hatch |
| `close()` | Tear down (idempotent) |

### `expectToolResult(result) → ToolResultAssertion`

Chainable, throws a plain `Error` on failure:

`toSucceed()` · `toError()` / `toFail()` · `toHaveText(string | RegExp)` · `toHaveContentType(type)` · `toHaveContentCount(n)` · `toSatisfy(fn)` · `toMatchStructured(partial)` · `toMatchSchema(jsonSchema)` — plus terminal getters `text()`, `json<T>()`, `raw()`.

### `conformanceCheck(client, options?) → Promise<ConformanceReport>`

Runs the best-practices battery (see `listChecks()` for the full catalogue). `report.ok` is `true` unless an **error**-severity check fails. `options`: `{ skip?: string[], probeUnknownTool?: boolean }`.

| Check | Severity |
| --- | --- |
| `server-identity` | warning |
| `tools-listable` | error |
| `unique-tool-names` | error |
| `valid-tool-names` | error |
| `tool-descriptions` | warning |
| `description-quality` | info |
| `tool-input-schema` | warning |
| `required-props-exist` | error |
| `unknown-tool-handled` | error |

### `validateAgainstSchema(value, jsonSchema) → { valid, errors }`

A small, dependency-free JSON Schema validator covering the subset MCP tools use (types, `required`, `enum`, nested objects/arrays, numeric/string bounds, `anyOf`/`oneOf`/`allOf`, `additionalProperties`). Returns **every** error, not just the first.

### `mockServer(spec) → McpServer`

Build a throwaway server for fixtures. Input schemas are passed straight to the SDK's `registerTool`, so they take a Zod raw-shape:

```ts
import { z } from "zod";
import { mockServer, createTestClient } from "mcp-devkit";

const server = mockServer({
  name: "demo",
  tools: [{
    name: "echo",
    description: "Echo the message back",
    inputSchema: { message: z.string() },
    handler: ({ message }) => `you said: ${message}`,
  }],
});

const client = await createTestClient({ server });
```

A handler returns either a string (wrapped as one text block) or `{ content?, isError?, structuredContent? }`.

---

## License

MIT © sriramadari
