import { describe, expect, it } from "vitest";
import { expectToolResult } from "../src/expect";
import type { ToolResult } from "../src/types";

const ok: ToolResult = { content: [{ type: "text", text: "found 3 results" }] };
const errored: ToolResult = { content: [{ type: "text", text: "boom" }], isError: true };
const structured: ToolResult = {
  content: [{ type: "text", text: '{"count":3,"items":["a"]}' }],
  structuredContent: { count: 3, items: ["a"], extra: true },
};

describe("expectToolResult", () => {
  it("toSucceed passes on a non-error result", () => {
    expect(() => expectToolResult(ok).toSucceed()).not.toThrow();
  });

  it("toSucceed throws on an error result", () => {
    expect(() => expectToolResult(errored).toSucceed()).toThrow(/succeed/);
  });

  it("toError passes on an error result and throws otherwise", () => {
    expect(() => expectToolResult(errored).toError()).not.toThrow();
    expect(() => expectToolResult(ok).toError()).toThrow();
  });

  it("toHaveText matches substrings and regexes", () => {
    expect(() => expectToolResult(ok).toHaveText("found")).not.toThrow();
    expect(() => expectToolResult(ok).toHaveText(/\d+ results/)).not.toThrow();
    expect(() => expectToolResult(ok).toHaveText("missing")).toThrow();
  });

  it("text() joins text blocks and json() parses them", () => {
    expect(expectToolResult(ok).text()).toBe("found 3 results");
    expect(expectToolResult(structured).json()).toEqual({ count: 3, items: ["a"] });
  });

  it("toMatchStructured does a subset match", () => {
    expect(() => expectToolResult(structured).toMatchStructured({ count: 3 })).not.toThrow();
    expect(() => expectToolResult(structured).toMatchStructured({ items: ["a"] })).not.toThrow();
    expect(() => expectToolResult(structured).toMatchStructured({ count: 4 })).toThrow(/mismatch/);
  });

  it("toMatchSchema validates structuredContent", () => {
    expect(() =>
      expectToolResult(structured).toMatchSchema({ type: "object", required: ["count"], properties: { count: { type: "integer" } } }),
    ).not.toThrow();
    expect(() =>
      expectToolResult(structured).toMatchSchema({ type: "object", properties: { count: { type: "string" } } }),
    ).toThrow();
  });

  it("toHaveContentType / count work", () => {
    expect(() => expectToolResult(ok).toHaveContentType("text")).not.toThrow();
    expect(() => expectToolResult(ok).toHaveContentType("image")).toThrow();
    expect(() => expectToolResult(ok).toHaveContentCount(1)).not.toThrow();
  });

  it("matchers chain", () => {
    expect(() =>
      expectToolResult(structured).toSucceed().toHaveText(/count/).toMatchStructured({ count: 3 }),
    ).not.toThrow();
  });

  it("rejects non-tool-result values", () => {
    // @ts-expect-error intentionally wrong shape
    expect(() => expectToolResult({ foo: 1 })).toThrow(/not an MCP tool result/);
  });
});
