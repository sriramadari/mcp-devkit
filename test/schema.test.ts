import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "../src/schema";

describe("validateAgainstSchema", () => {
  it("accepts a matching object", () => {
    const r = validateAgainstSchema(
      { name: "ada", age: 36 },
      { type: "object", properties: { name: { type: "string" }, age: { type: "integer" } }, required: ["name"] },
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("reports a missing required property", () => {
    const r = validateAgainstSchema({ age: 1 }, { type: "object", properties: { name: { type: "string" } }, required: ["name"] });
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.path).toBe("/name");
    expect(r.errors[0]?.message).toMatch(/required/);
  });

  it("reports a wrong type", () => {
    const r = validateAgainstSchema({ age: "old" }, { type: "object", properties: { age: { type: "number" } } });
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.path).toBe("/age");
    expect(r.errors[0]?.message).toMatch(/expected type number/);
  });

  it("treats integer strictly", () => {
    expect(validateAgainstSchema(3.5, { type: "integer" }).valid).toBe(false);
    expect(validateAgainstSchema(3, { type: "integer" }).valid).toBe(true);
  });

  it("enforces enum membership", () => {
    const schema = { enum: ["a", "b"] };
    expect(validateAgainstSchema("a", schema).valid).toBe(true);
    expect(validateAgainstSchema("c", schema).valid).toBe(false);
  });

  it("enforces numeric bounds", () => {
    expect(validateAgainstSchema(11, { type: "number", maximum: 10 }).valid).toBe(false);
    expect(validateAgainstSchema(5, { type: "number", minimum: 1, maximum: 10 }).valid).toBe(true);
  });

  it("enforces string length", () => {
    expect(validateAgainstSchema("", { type: "string", minLength: 1 }).valid).toBe(false);
    expect(validateAgainstSchema("ok", { type: "string", maxLength: 1 }).valid).toBe(false);
  });

  it("validates nested objects and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
      },
    } as const;
    expect(validateAgainstSchema({ items: [{ id: 1 }, { id: 2 }] }, schema).valid).toBe(true);
    const bad = validateAgainstSchema({ items: [{ id: 1 }, { id: "x" }] }, schema);
    expect(bad.valid).toBe(false);
    expect(bad.errors[0]?.path).toBe("/items/1/id");
  });

  it("rejects additional properties when forbidden", () => {
    const r = validateAgainstSchema(
      { a: 1, b: 2 },
      { type: "object", properties: { a: { type: "number" } }, additionalProperties: false },
    );
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.path).toBe("/b");
  });

  it("handles anyOf / oneOf", () => {
    const anyOf = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(validateAgainstSchema("x", anyOf).valid).toBe(true);
    expect(validateAgainstSchema(true, anyOf).valid).toBe(false);

    const oneOf = { oneOf: [{ type: "string" }, { type: "string", minLength: 3 }] };
    // "ab" matches only the first → exactly one → valid
    expect(validateAgainstSchema("ab", oneOf).valid).toBe(true);
    // "abcd" matches both → not exactly one → invalid
    expect(validateAgainstSchema("abcd", oneOf).valid).toBe(false);
  });
});
