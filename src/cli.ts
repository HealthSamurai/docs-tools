#!/usr/bin/env bun
import { resolve } from "path";
import { loadConfig } from "./config";
import { allChecks } from "./checks";
import { buildContext, runChecks, filterChecks } from "./runner";
import { printResult, printSummary, printJson } from "./output";

function usage(): void {
  console.log(`Usage: docs-lint [options]

Options:
  --check <id>      Run a single check
  --list            List available checks
  --json            Output results as JSON
  --install-hook    Install pre-push git hook
  --help            Show this help

Examples:
  docs-lint                        Run all checks
  docs-lint --check broken-links   Run one check
  docs-lint --list                 List available checks
  docs-lint --json                 JSON output for CI`);
}

async function installHook(): Promise<void> {
  const hookPath = resolve(process.cwd(), ".git/hooks/pre-push");
  const hookContent = `#!/bin/sh
# docs-lint pre-push hook
bun docs-lint || exit 1
`;
  await Bun.write(hookPath, hookContent);
  const { execSync } = await import("child_process");
  execSync(`chmod +x ${hookPath}`);
  console.log("Installed pre-push hook at .git/hooks/pre-push");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(0);
  }

  if (args.includes("--list")) {
    console.log("Available checks:\n");
    for (const check of allChecks) {
      const sev = check.severity === "warning" ? "(warning)" : "";
      console.log(`  ${check.id.padEnd(24)} ${check.name} ${sev}`);
    }
    process.exit(0);
  }

  if (args.includes("--install-hook")) {
    await installHook();
    process.exit(0);
  }

  const jsonMode = args.includes("--json");
  let only: string | undefined;

  const checkIdx = args.indexOf("--check");
  if (checkIdx !== -1) {
    only = args[checkIdx + 1];
    if (!only) {
      console.error("Error: --check requires a check ID");
      process.exit(1);
    }
  }

  const root = process.cwd();
  const config = await loadConfig(root);

  let checks;
  try {
    checks = filterChecks(allChecks, config, only);
  } catch (e: unknown) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const ctx = await buildContext(root, config);

  if (!jsonMode) {
    console.log(`=== docs-lint ===`);
    console.log(`Root: ${root}`);
    console.log(`Docs: ${config.docs_dir}/ (${ctx.files.length} files)`);
  }

  const results = await runChecks(checks, ctx);

  if (jsonMode) {
    printJson(results);
  } else {
    for (const result of results) {
      printResult(result);
    }
    printSummary(results);
  }

  const hasErrors = results.some(
    (r) => r.severity === "error" && r.issues.length > 0,
  );
  process.exit(hasErrors ? 1 : 0);
}

main();
