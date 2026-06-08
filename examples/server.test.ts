/**
 * examples/server.test.ts — what testing your own MCP server looks like.
 *
 * Copy this into your project's test suite, swap `mockServer(...)` for your own
 * server factory, and you have end-to-end coverage of your tools with no child
 * process and no network. Run with `vitest`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createTestClient,
  expectToolResult,
  conformanceCheck,
  mockServer,
  type TestClient,
} from "mcp-devkit";

// --- the server under test (here, a mock — swap for `buildMyServer()`) -------
function buildServer() {
  return mockServer({
    name: "weather",
    version: "1.0.0",
    tools: [
      {
        name: "get_forecast",
        description: "Get the forecast for a city for the next N days",
        inputSchema: { city: z.string(), days: z.number().int().min(1).max(7) },
        handler: ({ city, days }) => ({
          content: [{ type: "text", text: `Forecast for ${city}: sunny for ${days} day(s)` }],
          structuredContent: { city, days, summary: "sunny" },
        }),
      },
    ],
  });
}

describe("weather MCP server", () => {
  let client: TestClient;

  beforeAll(async () => {
    client = await createTestClient({ server: buildServer() });
  });
  afterAll(async () => {
    await client.close();
  });

  it("advertises the get_forecast tool", async () => {
    expect(await client.hasTool("get_forecast")).toBe(true);
  });

  it("returns a forecast", async () => {
    const res = await client.call("get_forecast", { city: "Paris", days: 3 });
    expectToolResult(res)
      .toSucceed()
      .toHaveText(/Paris: sunny for 3/)
      .toMatchStructured({ city: "Paris", summary: "sunny" });
  });

  it("validates args before sending (days out of range)", async () => {
    // Client-side schema validation catches this before it hits the server.
    await expect(client.call("get_forecast", { city: "Paris", days: 99 })).rejects.toThrow();
  });

  it("passes the conformance battery", async () => {
    const report = await conformanceCheck(client);
    expect(report.ok).toBe(true);
  });
});
