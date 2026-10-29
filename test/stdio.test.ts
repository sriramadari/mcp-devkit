import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { createTestClient, expectToolResult } from "../src";

const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));

describe("stdio transport", () => {
  it("spawns a server, calls a tool, and tears down", async () => {
    const client = await createTestClient({ command: process.execPath, args: [fixture] });
    try {
      expectToolResult(await client.call("ping", {})).toSucceed().toHaveText("pong");
    } finally {
      await client.close();
    }
  });
});
