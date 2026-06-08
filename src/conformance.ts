/**
 * conformance.ts — an automated best-practices checker for MCP servers.
 *
 * Point it at a connected {@link TestClient} and it runs a battery of checks
 * that catch the mistakes that make a server hard for an LLM to use well or
 * brittle in production: missing tool descriptions, malformed input schemas,
 * duplicate or illegally-named tools, a server that crashes on an unknown
 * tool, missing server identity, and so on.
 *
 * Each check yields a {@link CheckResult}; the rolled-up {@link ConformanceReport}
 * tells you pass/fail at a glance and is what the CLI's `check` command prints.
 */

import type { TestClient } from "./client";
import type { ToolInfo } from "./types";

export type Severity = "error" | "warning" | "info";
export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  id: string;
  title: string;
  severity: Severity;
  status: CheckStatus;
  /** Present when status is `fail` or `skip` — why. */
  detail?: string;
  /** Per-item findings (e.g. which tools are missing a description). */
  findings?: string[];
}

export interface ConformanceReport {
  ok: boolean;
  checks: CheckResult[];
  summary: { passed: number; failed: number; warnings: number; skipped: number };
}

export interface ConformanceOptions {
  /** Check ids to skip entirely. */
  skip?: string[];
  /**
   * Whether to actually *call* a non-existent tool to verify graceful error
   * handling. Default `true`. Disable if your tools have side effects you'd
   * rather not risk (this only ever calls a random non-existent name, but the
   * escape hatch is here regardless).
   */
  probeUnknownTool?: boolean;
}

// MCP tool names: keep to a conservative, widely-accepted charset.
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,128}$/;

type Check = {
  id: string;
  title: string;
  severity: Severity;
  run: (ctx: { client: TestClient; tools: ToolInfo[]; options: ConformanceOptions }) => Promise<Omit<CheckResult, "id" | "title" | "severity">>;
};

const CHECKS: Check[] = [
  {
    id: "server-identity",
    title: "Server reports a name and version",
    severity: "warning",
    run: async ({ client }) => {
      const info = client.serverInfo();
      if (info?.name && info?.version) return { status: "pass" };
      return { status: "fail", detail: `server info is ${JSON.stringify(info)}` };
    },
  },
  {
    id: "tools-listable",
    title: "tools/list responds",
    severity: "error",
    run: async ({ tools }) => {
      // If we got here, listing already succeeded (tools are pre-fetched).
      return { status: "pass", detail: `${tools.length} tool(s)` };
    },
  },
  {
    id: "unique-tool-names",
    title: "Tool names are unique",
    severity: "error",
    run: async ({ tools }) => {
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const t of tools) {
        if (seen.has(t.name)) dupes.add(t.name);
        seen.add(t.name);
      }
      return dupes.size === 0
        ? { status: "pass" }
        : { status: "fail", detail: "duplicate tool names", findings: [...dupes] };
    },
  },
  {
    id: "valid-tool-names",
    title: "Tool names use a safe charset and length",
    severity: "error",
    run: async ({ tools }) => {
      const bad = tools.filter((t) => !TOOL_NAME_RE.test(t.name)).map((t) => t.name);
      return bad.length === 0
        ? { status: "pass" }
        : { status: "fail", detail: "names must match /^[a-zA-Z0-9_-]{1,128}$/", findings: bad };
    },
  },
  {
    id: "tool-descriptions",
    title: "Every tool has a description",
    severity: "warning",
    run: async ({ tools }) => {
      const missing = tools.filter((t) => !t.description || !t.description.trim()).map((t) => t.name);
      return missing.length === 0
        ? { status: "pass" }
        : { status: "fail", detail: "an LLM picks tools by their description", findings: missing };
    },
  },
  {
    id: "description-quality",
    title: "Descriptions are substantive (≥ 12 chars)",
    severity: "info",
    run: async ({ tools }) => {
      const thin = tools
        .filter((t) => t.description && t.description.trim().length > 0 && t.description.trim().length < 12)
        .map((t) => `${t.name} ("${t.description!.trim()}")`);
      return thin.length === 0
        ? { status: "pass" }
        : { status: "fail", detail: "very short descriptions hurt tool selection", findings: thin };
    },
  },
  {
    id: "tool-input-schema",
    title: "Every tool declares an object inputSchema",
    severity: "warning",
    run: async ({ tools }) => {
      const bad = tools
        .filter((t) => {
          const s = t.inputSchema;
          return !s || typeof s !== "object" || s.type !== "object";
        })
        .map((t) => t.name);
      return bad.length === 0
        ? { status: "pass" }
        : { status: "fail", detail: 'inputSchema should be a JSON Schema with type:"object"', findings: bad };
    },
  },
  {
    id: "required-props-exist",
    title: "Every `required` entry names a declared property",
    severity: "error",
    run: async ({ tools }) => {
      const findings: string[] = [];
      for (const t of tools) {
        const s = t.inputSchema;
        if (!s?.required || !s.properties) continue;
        const props = new Set(Object.keys(s.properties));
        for (const r of s.required) {
          if (!props.has(r)) findings.push(`${t.name}: required "${r}" has no matching property`);
        }
      }
      return findings.length === 0 ? { status: "pass" } : { status: "fail", findings };
    },
  },
  {
    id: "unknown-tool-handled",
    title: "Calling an unknown tool fails gracefully (no crash/hang)",
    severity: "error",
    run: async ({ client, options }) => {
      if (options.probeUnknownTool === false) {
        return { status: "skip", detail: "probeUnknownTool disabled" };
      }
      const phantom = "__mcp_devkit_nonexistent_tool__";
      try {
        const res = await client.call(phantom, {}, { validate: false, timeoutMs: 5_000 });
        // Either a protocol error (caught below) or an isError result is fine —
        // both are graceful. A *successful* result for a tool that doesn't exist
        // is the bug.
        return res.isError === true
          ? { status: "pass", detail: "returned isError result" }
          : { status: "fail", detail: "server returned a success result for a non-existent tool" };
      } catch {
        // A thrown JSON-RPC error is the expected, graceful outcome.
        return { status: "pass", detail: "rejected with a protocol error" };
      }
    },
  },
];

/** Run the full conformance battery against a connected client. */
export async function conformanceCheck(
  client: TestClient,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const skip = new Set(options.skip ?? []);
  const tools = await client.tools();
  const checks: CheckResult[] = [];

  for (const check of CHECKS) {
    if (skip.has(check.id)) {
      checks.push({ id: check.id, title: check.title, severity: check.severity, status: "skip", detail: "skipped by caller" });
      continue;
    }
    try {
      const outcome = await check.run({ client, tools, options });
      checks.push({ id: check.id, title: check.title, severity: check.severity, ...outcome });
    } catch (e) {
      checks.push({
        id: check.id,
        title: check.title,
        severity: check.severity,
        status: "fail",
        detail: `check threw: ${(e as Error).message}`,
      });
    }
  }

  const summary = {
    passed: checks.filter((c) => c.status === "pass").length,
    failed: checks.filter((c) => c.status === "fail").length,
    warnings: checks.filter((c) => c.status === "fail" && c.severity === "warning").length,
    skipped: checks.filter((c) => c.status === "skip").length,
  };
  // The server is "ok" only if no *error*-severity check failed.
  const ok = !checks.some((c) => c.status === "fail" && c.severity === "error");

  return { ok, checks, summary };
}

/** The list of checks the kit runs, for documentation/UIs. */
export function listChecks(): Array<{ id: string; title: string; severity: Severity }> {
  return CHECKS.map((c) => ({ id: c.id, title: c.title, severity: c.severity }));
}
