/**
 * expect.ts — fluent, framework-agnostic assertions for MCP tool results.
 *
 * These throw a plain `Error` on failure (no dependency on vitest/jest/node:test),
 * so they slot into any runner. Every matcher returns `this`, so they chain:
 *
 * ```ts
 * expectToolResult(res)
 *   .toSucceed()
 *   .toHaveText(/found 3 results/)
 *   .toMatchStructured({ count: 3 });
 * ```
 */

import { validateAgainstSchema } from "./schema";
import type { ContentBlock, JsonSchema, ToolResult } from "./types";

export class ToolResultAssertion {
  constructor(private readonly result: ToolResult) {
    if (!result || !Array.isArray(result.content)) {
      throw new Error(
        "expectToolResult: value is not an MCP tool result (missing `content` array)",
      );
    }
  }

  /** The text of all `type: "text"` content blocks, joined by newlines. */
  text(): string {
    return this.result.content
      .filter((b): b is ContentBlock & { text: string } => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }

  /** Parse the joined text content as JSON. Throws if it isn't valid JSON. */
  json<T = unknown>(): T {
    const text = this.text();
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new Error(`expected tool result text to be JSON, but parsing failed: ${(e as Error).message}\n--- text ---\n${text}`);
    }
  }

  /** The raw result, for assertions the matchers don't cover. */
  raw(): ToolResult {
    return this.result;
  }

  // ── success / failure ───────────────────────────────────────────────────────

  /** Asserts the tool did NOT report an error (`isError` is not true). */
  toSucceed(): this {
    if (this.result.isError === true) {
      throw new Error(`expected tool result to succeed, but isError=true\n--- content ---\n${this.text()}`);
    }
    return this;
  }

  /** Asserts the tool reported an error (`isError === true`). */
  toError(): this {
    if (this.result.isError !== true) {
      throw new Error(`expected tool result to be an error (isError=true), but it succeeded\n--- content ---\n${this.text()}`);
    }
    return this;
  }

  /** Alias for {@link toError}. */
  toFail(): this {
    return this.toError();
  }

  // ── content ─────────────────────────────────────────────────────────────────

  /** Asserts the joined text content contains a substring, or matches a RegExp. */
  toHaveText(expected: string | RegExp): this {
    const text = this.text();
    const ok = typeof expected === "string" ? text.includes(expected) : expected.test(text);
    if (!ok) {
      throw new Error(`expected tool text to ${typeof expected === "string" ? `contain "${expected}"` : `match ${expected}`}, got:\n${text}`);
    }
    return this;
  }

  /** Asserts there is at least one content block of the given type. */
  toHaveContentType(type: string): this {
    if (!this.result.content.some((b) => b.type === type)) {
      const seen = [...new Set(this.result.content.map((b) => b.type))].join(", ") || "(none)";
      throw new Error(`expected a content block of type "${type}", but saw: ${seen}`);
    }
    return this;
  }

  /** Asserts the number of content blocks. */
  toHaveContentCount(n: number): this {
    if (this.result.content.length !== n) {
      throw new Error(`expected ${n} content block(s), got ${this.result.content.length}`);
    }
    return this;
  }

  /** Asserts at least one content block satisfies the predicate. */
  toSatisfy(predicate: (block: ContentBlock) => boolean, message = "predicate"): this {
    if (!this.result.content.some(predicate)) {
      throw new Error(`expected at least one content block to satisfy ${message}`);
    }
    return this;
  }

  // ── structured content ──────────────────────────────────────────────────────

  /**
   * Asserts `structuredContent` deep-contains the given partial object.
   * (Recursive subset match — extra keys on the actual value are fine.)
   */
  toMatchStructured(expected: Record<string, unknown>): this {
    const actual = this.result.structuredContent;
    const miss = subsetMismatch(actual, expected, "");
    if (miss) {
      throw new Error(`structuredContent mismatch at ${miss.path}: ${miss.message}\n--- actual ---\n${JSON.stringify(actual, null, 2)}`);
    }
    return this;
  }

  /** Asserts `structuredContent` validates against a JSON Schema. */
  toMatchSchema(schema: JsonSchema): this {
    const { valid, errors } = validateAgainstSchema(this.result.structuredContent, schema);
    if (!valid) {
      const detail = errors.map((e) => `  ${e.path} ${e.message}`).join("\n");
      throw new Error(`structuredContent does not match schema:\n${detail}`);
    }
    return this;
  }
}

function subsetMismatch(actual: unknown, expected: unknown, path: string): { path: string; message: string } | null {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return { path: path || "/", message: `expected an object, got ${actual === null ? "null" : Array.isArray(actual) ? "array" : typeof actual}` };
    }
    for (const [k, v] of Object.entries(expected)) {
      const sub = subsetMismatch((actual as Record<string, unknown>)[k], v, `${path}/${k}`);
      if (sub) return sub;
    }
    return null;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return { path: path || "/", message: `expected an array, got ${typeof actual}` };
    if (actual.length !== expected.length) return { path: path || "/", message: `expected length ${expected.length}, got ${actual.length}` };
    for (let i = 0; i < expected.length; i++) {
      const sub = subsetMismatch(actual[i], expected[i], `${path}/${i}`);
      if (sub) return sub;
    }
    return null;
  }
  if (actual !== expected) {
    return { path: path || "/", message: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
  }
  return null;
}

/** Wrap a tool result in a chainable assertion. */
export function expectToolResult(result: ToolResult): ToolResultAssertion {
  return new ToolResultAssertion(result);
}
