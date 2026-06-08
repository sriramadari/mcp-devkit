/**
 * mcp-devkit — a testing & inspection toolkit for Model Context Protocol servers.
 *
 * @packageDocumentation
 */

// Test client
export { createTestClient, withTestClient, TestClient } from "./client";
export type { CallOptions } from "./client";

// Connection (escape hatch for advanced wiring)
export { openConnection } from "./connect";
export type { Connection } from "./connect";

// Assertions
export { expectToolResult, ToolResultAssertion } from "./expect";

// Conformance checker
export { conformanceCheck, listChecks } from "./conformance";
export type {
  ConformanceReport,
  ConformanceOptions,
  CheckResult,
  CheckStatus,
  Severity,
} from "./conformance";

// Schema validation
export { validateAgainstSchema } from "./schema";
export type { ValidationResult, ValidationError } from "./schema";

// Mock server fixtures
export { mockServer } from "./mock";
export type { MockServerSpec, MockToolSpec, MockToolReturn } from "./mock";

// Shared types
export type {
  ConnectTarget,
  ConnectOptions,
  ToolResult,
  ToolInfo,
  ResourceInfo,
  PromptInfo,
  ContentBlock,
  JsonSchema,
  JsonSchemaType,
} from "./types";
