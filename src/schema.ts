/**
 * schema.ts — a tiny, dependency-free JSON Schema validator.
 *
 * This is NOT a spec-complete validator (use ajv for that). It covers the
 * subset MCP tool `inputSchema`s actually use in practice — types, required
 * properties, enums, nested objects/arrays, basic numeric/string bounds, and
 * the combinators — so a test can catch "I'm calling this tool with the wrong
 * args" before the call ever leaves the process.
 */

import type { JsonSchema, JsonSchemaType } from "./types";

export interface ValidationError {
  /** JSON-pointer-ish path to the offending value, e.g. `/items/0/name`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const TYPEOF: Record<string, JsonSchemaType> = {
  string: "string",
  number: "number",
  boolean: "boolean",
};

function typeOf(value: unknown): JsonSchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object") return "object";
  return TYPEOF[t] ?? "string";
}

function matchesType(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number";
    case "null":
      return value === null;
    default:
      return typeOf(value) === type;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Validate `value` against `schema`. Returns every error found, not just the
 * first — handy for surfacing all the problems with a tool call at once.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchema): ValidationResult {
  const errors: ValidationError[] = [];
  walk(value, schema, "", errors);
  return { valid: errors.length === 0, errors };
}

function walk(value: unknown, schema: JsonSchema, path: string, errors: ValidationError[]): void {
  if (!schema || typeof schema !== "object") return;

  // const / enum
  if ("const" in schema && !deepEqual(value, schema.const)) {
    errors.push({ path: path || "/", message: `must equal ${JSON.stringify(schema.const)}` });
  }
  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push({ path: path || "/", message: `must be one of ${JSON.stringify(schema.enum)}` });
  }

  // combinators
  if (schema.allOf) {
    for (const sub of schema.allOf) walk(value, sub, path, errors);
  }
  if (schema.anyOf && !schema.anyOf.some((sub) => validateAgainstSchema(value, sub).valid)) {
    errors.push({ path: path || "/", message: "did not match any schema in anyOf" });
  }
  if (schema.oneOf) {
    const hits = schema.oneOf.filter((sub) => validateAgainstSchema(value, sub).valid).length;
    if (hits !== 1) {
      errors.push({ path: path || "/", message: `must match exactly one schema in oneOf (matched ${hits})` });
    }
  }

  // type
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
    errors.push({ path: path || "/", message: `expected type ${types.join(" | ")}, got ${typeOf(value)}` });
    return; // further checks would be noise once the type is wrong
  }

  const actual = typeOf(value);

  if (actual === "string" && typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path: path || "/", message: `shorter than minLength ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path: path || "/", message: `longer than maxLength ${schema.maxLength}` });
    }
  }

  if (actual === "number" && typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path: path || "/", message: `less than minimum ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({ path: path || "/", message: `greater than maximum ${schema.maximum}` });
    }
  }

  if (actual === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) {
        errors.push({ path: `${path}/${key}`, message: "is required" });
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) walk(obj[key], sub, `${path}/${key}`, errors);
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${path}/${key}`, message: "is not an allowed property" });
        }
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const declared = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!declared.has(key)) {
          walk(obj[key], schema.additionalProperties, `${path}/${key}`, errors);
        }
      }
    }
  }

  if (actual === "array" && Array.isArray(value)) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((sub, i) => {
        if (i < value.length) walk(value[i], sub, `${path}/${i}`, errors);
      });
    } else if (schema.items) {
      value.forEach((item, i) => walk(item, schema.items as JsonSchema, `${path}/${i}`, errors));
    }
  }
}
