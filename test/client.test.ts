import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestClient, withTestClient, type TestClient } from "../src/client";
import { expectToolResult } from "../src/expect";
import { mockServer } from "../src/mock";

function demoServer() {
  return mockServer({
    name: "demo",
    version: "1.2.3",
    tools: [
      {
        name: "echo",
        description: "Echo a message back to the caller",
        inputSchema: { message: z.string() },
        handler: ({ message }) => `echo: ${message}`,
      },
      {
        name: "add",
        description: "Add two integers and return the sum",
        inputSchema: { a: z.number(), b: z.number() },
        handler: ({ a, b }) => ({
          content: [{ type: "text", text: String((a as number) + (b as number)) }],
          structuredContent: { sum: (a as number) + (b as number) },
        }),
      },
      {
        name: "always_fails",
        description: "A tool that reports an execution error",
        handler: () => ({ content: [{ type: "text", text: "nope" }], isError: true }),
      },
    ],
  });
}

let open: TestClient | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe("createTestClient (in-memory)", () => {
  it("reports server identity", async () => {
    open = await createTestClient({ server: demoServer() });
    expect(open.serverInfo()).toMatchObject({ name: "demo", version: "1.2.3" });
  });

  it("lists tools and caches them", async () => {
    open = await createTestClient({ server: demoServer() });
    expect(await open.toolNames()).toEqual(expect.arrayContaining(["echo", "add", "always_fails"]));
    expect(await open.hasTool("echo")).toBe(true);
    expect(await open.hasTool("nope")).toBe(false);
  });

  it("calls a tool and returns its result", async () => {
    open = await createTestClient({ server: demoServer() });
    const res = await open.call("echo", { message: "hi" });
    expectToolResult(res).toSucceed().toHaveText("echo: hi");
  });

  it("surfaces structuredContent", async () => {
    open = await createTestClient({ server: demoServer() });
    const res = await open.call("add", { a: 2, b: 3 });
    expectToolResult(res).toSucceed().toHaveText("5").toMatchStructured({ sum: 5 });
  });

  it("propagates isError results", async () => {
    open = await createTestClient({ server: demoServer() });
    expectToolResult(await open.call("always_fails")).toError();
  });

  it("validates args against inputSchema before sending", async () => {
    open = await createTestClient({ server: demoServer() });
    // `message` should be a string — number fails client-side validation.
    await expect(open.call("echo", { message: 123 })).rejects.toThrow(/inputSchema/);
  });

  it("can skip validation with { validate: false }", async () => {
    open = await createTestClient({ server: demoServer() });
    // Bypassing our check, the server's own Zod validation rejects it. The SDK
    // surfaces that as an isError result (not a thrown protocol error).
    const res = await open.call("echo", { message: 123 }, { validate: false });
    expectToolResult(res).toError().toHaveText(/Invalid arguments/i);
  });

  it("returns empty lists for unsupported capabilities", async () => {
    open = await createTestClient({ server: demoServer() });
    expect(await open.resources()).toEqual([]);
    expect(await open.prompts()).toEqual([]);
  });

  it("answers a ping", async () => {
    open = await createTestClient({ server: demoServer() });
    await expect(open.ping()).resolves.toBeUndefined();
  });
});

describe("withTestClient", () => {
  it("closes the client even when the body throws", async () => {
    let captured: TestClient | undefined;
    await expect(
      withTestClient({ server: demoServer() }, async (client) => {
        captured = client;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // A second close should be a no-op (already closed) and not throw.
    await expect(captured!.close()).resolves.toBeUndefined();
  });
});
