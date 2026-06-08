import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestClient, type TestClient } from "../src/client";
import { conformanceCheck, listChecks } from "../src/conformance";
import { mockServer } from "../src/mock";

let open: TestClient | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

function goodServer() {
  return mockServer({
    name: "good",
    version: "1.0.0",
    tools: [
      {
        name: "search",
        description: "Search the corpus for a query string",
        inputSchema: { q: z.string() },
        handler: ({ q }) => `results for ${q}`,
      },
    ],
  });
}

describe("conformanceCheck", () => {
  it("a well-formed server passes", async () => {
    open = await createTestClient({ server: goodServer() });
    const report = await conformanceCheck(open);
    expect(report.ok).toBe(true);
    expect(report.summary.failed).toBe(0);
  });

  it("flags a tool with no description (warning, not a hard fail)", async () => {
    open = await createTestClient({
      server: mockServer({
        name: "thin",
        tools: [{ name: "mystery", handler: () => "?" }], // no description
      }),
    });
    const report = await conformanceCheck(open);
    const descCheck = report.checks.find((c) => c.id === "tool-descriptions");
    expect(descCheck?.status).toBe("fail");
    expect(descCheck?.findings).toContain("mystery");
    // description is a warning-severity check, so the server is still "ok"
    expect(report.ok).toBe(true);
  });

  it("verifies unknown tools are handled gracefully", async () => {
    open = await createTestClient({ server: goodServer() });
    const report = await conformanceCheck(open);
    const unknown = report.checks.find((c) => c.id === "unknown-tool-handled");
    expect(unknown?.status).toBe("pass");
  });

  it("honours the skip option", async () => {
    open = await createTestClient({ server: goodServer() });
    const report = await conformanceCheck(open, { skip: ["unknown-tool-handled"] });
    const skipped = report.checks.find((c) => c.id === "unknown-tool-handled");
    expect(skipped?.status).toBe("skip");
  });

  it("exposes the catalogue of checks", () => {
    const checks = listChecks();
    expect(checks.length).toBeGreaterThan(5);
    expect(checks.every((c) => c.id && c.title && c.severity)).toBe(true);
  });
});
