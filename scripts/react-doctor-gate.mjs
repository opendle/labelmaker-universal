#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const version = "0.2.3";
const workspace = "packages/ui";
const command = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  command,
  [
    "exec",
    "--yes",
    "--package",
    `react-doctor@${version}`,
    "--",
    "react-doctor",
    workspace,
    "--json",
    "--json-compact",
    "--full",
    "--fail-on",
    "none",
  ],
  { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] },
);

if (result.status !== 0) {
  process.stderr.write("React Doctor failed to run for packages/ui\n");
  process.stderr.write(result.stderr || result.stdout);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write("React Doctor returned invalid JSON\n");
  process.stderr.write(result.stdout);
  process.exit(1);
}
const projects = Array.isArray(report.projects) ? report.projects : [];
const project = projects[0];
const diagnostics = Array.isArray(project?.diagnostics)
  ? project.diagnostics
  : [];
const diagnosticCount = report.summary?.totalDiagnosticCount;
const score = project?.score?.score;

if (
  projects.length !== 1 ||
  score !== 100 ||
  diagnostics.length !== 0 ||
  diagnosticCount !== 0
) {
  process.stderr.write(
    `React Doctor gate failed for ${workspace}: score must be 100 and diagnostics must be zero.\n`,
  );
  process.stderr.write(
    `score: ${String(score ?? "unknown")}\ndiagnostics: ${String(diagnosticCount ?? diagnostics.length)}\n`,
  );
  for (const item of diagnostics) {
    process.stderr.write(
      `- ${String(item.filePath)}: ${String(item.plugin)}/${String(item.rule)} [${String(item.severity)}] ${String(item.message)}\n`,
    );
  }
  process.exit(1);
}

process.stdout.write("score: 100; diagnostics: 0\n");
