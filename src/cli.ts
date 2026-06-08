#!/usr/bin/env node
/**
 * cli.ts — `mcp-devkit` command-line entry point.
 *
 * Drives a stdio MCP server (launched as a child process) for three jobs you
 * don't want to write a script for:
 *
 *   mcp-devkit inspect -- <command...>          dump tools / resources / prompts
 *   mcp-devkit check   -- <command...>          run the conformance battery
 *   mcp-devkit call --tool NAME [--args JSON] -- <command...>   invoke one tool
 *
 * Everything after `--` is the server command, e.g.
 *   mcp-devkit inspect -- node dist/server.js
 *   mcp-devkit check   -- npx -y @some/mcp-server
 */

import { parseArgs } from "node:util";
import { createTestClient } from "./client";
import { conformanceCheck } from "./conformance";
import type { CheckResult } from "./conformance";

// ── tiny ANSI helpers (respect NO_COLOR) ─────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
};

const USAGE = `${c.bold("mcp-devkit")} — testing & inspection toolkit for MCP servers

${c.bold("Usage:")}
  mcp-devkit inspect -- <command...>
  mcp-devkit check   -- <command...>
  mcp-devkit call --tool <name> [--args <json>] [--no-validate] -- <command...>

${c.bold("Examples:")}
  mcp-devkit inspect -- node dist/server.js
  mcp-devkit check   -- npx -y @modelcontextprotocol/server-everything
  mcp-devkit call --tool search --args '{"q":"mcp"}' -- node dist/server.js

${c.bold("Options:")}
  --tool <name>      tool to call (call command)
  --args <json>      JSON arguments object for the tool (default {})
  --no-validate      skip client-side inputSchema validation on call
  --json             machine-readable JSON output (inspect / check)
  --timeout <ms>     per-request timeout (default 15000)
  -h, --help         show this help

Everything after ${c.bold("--")} is the MCP server command to launch over stdio.
`;

/** Split argv into [devkit flags, server command] around the first `--`. */
function splitOnDoubleDash(argv: string[]): { flags: string[]; command: string[] } {
  const i = argv.indexOf("--");
  if (i === -1) return { flags: argv, command: [] };
  return { flags: argv.slice(0, i), command: argv.slice(i + 1) };
}

async function main(): Promise<number> {
  const rawArgv = process.argv.slice(2);
  const sub = rawArgv[0];

  if (!sub || sub === "-h" || sub === "--help" || sub === "help") {
    process.stdout.write(USAGE);
    return sub ? 0 : 1;
  }

  const { flags, command } = splitOnDoubleDash(rawArgv.slice(1));

  const { values } = parseArgs({
    args: flags,
    options: {
      tool: { type: "string" },
      args: { type: "string" },
      "no-validate": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      timeout: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (command.length === 0) {
    process.stderr.write(c.red("error: no server command given. Put it after `--`, e.g. `-- node dist/server.js`\n"));
    return 2;
  }

  const timeoutMs = values.timeout ? Number(values.timeout) : 15_000;
  const [cmd, ...cmdArgs] = command;

  const client = await createTestClient(
    { command: cmd!, args: cmdArgs },
    { timeoutMs },
  );

  try {
    switch (sub) {
      case "inspect":
        return await runInspect(client, !!values.json);
      case "check":
        return await runCheck(client, !!values.json);
      case "call":
        return await runCall(client, {
          tool: values.tool,
          args: values.args,
          validate: !values["no-validate"],
        });
      default:
        process.stderr.write(c.red(`error: unknown command "${sub}"\n\n`));
        process.stdout.write(USAGE);
        return 2;
    }
  } finally {
    await client.close().catch(() => {});
  }
}

async function runInspect(client: Awaited<ReturnType<typeof createTestClient>>, json: boolean): Promise<number> {
  const [tools, resources, prompts] = await Promise.all([
    client.tools(),
    client.resources(),
    client.prompts(),
  ]);
  const info = client.serverInfo();

  if (json) {
    process.stdout.write(JSON.stringify({ server: info, tools, resources, prompts }, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(
    `${c.bold(info?.name ?? "(unnamed server)")} ${c.dim("v" + (info?.version ?? "?"))}\n\n`,
  );

  process.stdout.write(c.bold(`Tools (${tools.length})\n`));
  for (const t of tools) {
    process.stdout.write(`  ${c.cyan(t.name)}${t.description ? "  " + c.dim(t.description) : ""}\n`);
    const props = t.inputSchema?.properties;
    if (props && Object.keys(props).length > 0) {
      const req = new Set(t.inputSchema?.required ?? []);
      for (const [name, sub] of Object.entries(props)) {
        const type = Array.isArray(sub.type) ? sub.type.join("|") : (sub.type ?? "any");
        process.stdout.write(`      ${name}${req.has(name) ? "*" : ""}: ${c.dim(String(type))}\n`);
      }
    }
  }

  if (resources.length > 0) {
    process.stdout.write("\n" + c.bold(`Resources (${resources.length})\n`));
    for (const r of resources) {
      process.stdout.write(`  ${c.cyan(r.uri)}${r.name ? "  " + c.dim(r.name) : ""}\n`);
    }
  }
  if (prompts.length > 0) {
    process.stdout.write("\n" + c.bold(`Prompts (${prompts.length})\n`));
    for (const p of prompts) {
      process.stdout.write(`  ${c.cyan(p.name)}${p.description ? "  " + c.dim(p.description) : ""}\n`);
    }
  }
  return 0;
}

async function runCheck(client: Awaited<ReturnType<typeof createTestClient>>, json: boolean): Promise<number> {
  const report = await conformanceCheck(client);

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report.ok ? 0 : 1;
  }

  const mark = (r: CheckResult) =>
    r.status === "pass" ? c.green("✓") : r.status === "skip" ? c.dim("–") : r.severity === "error" ? c.red("✗") : c.yellow("!");

  for (const r of report.checks) {
    process.stdout.write(`${mark(r)} ${r.title}${r.detail ? c.dim("  — " + r.detail) : ""}\n`);
    for (const f of r.findings ?? []) {
      process.stdout.write(`    ${c.dim("•")} ${f}\n`);
    }
  }

  const { passed, failed, skipped } = report.summary;
  process.stdout.write(
    `\n${report.ok ? c.green("PASS") : c.red("FAIL")}  ${passed} passed, ${failed} failed, ${skipped} skipped\n`,
  );
  return report.ok ? 0 : 1;
}

async function runCall(
  client: Awaited<ReturnType<typeof createTestClient>>,
  opts: { tool?: string; args?: string; validate: boolean },
): Promise<number> {
  if (!opts.tool) {
    process.stderr.write(c.red("error: --tool <name> is required for `call`\n"));
    return 2;
  }
  let args: Record<string, unknown> = {};
  if (opts.args) {
    try {
      args = JSON.parse(opts.args);
    } catch (e) {
      process.stderr.write(c.red(`error: --args is not valid JSON: ${(e as Error).message}\n`));
      return 2;
    }
  }

  const res = await client.call(opts.tool, args, { validate: opts.validate });
  process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  return res.isError ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`${c.red("error:")} ${err?.message ?? err}\n`);
    process.exit(1);
  });
