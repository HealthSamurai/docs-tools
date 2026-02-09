import type { CheckResult, Issue } from "./types";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

export function checkStart(name: string): void {
  console.log(`\n${DIM}[check]${RESET} ${BOLD}${name}${RESET}`);
}

export function checkSuccess(message: string): void {
  console.log(`        ${GREEN}\u2713${RESET} ${message}`);
}

export function checkError(message: string): void {
  console.log(`        ${RED}\u2717${RESET} ${message}`);
}

export function checkWarning(message: string): void {
  console.log(`        ${YELLOW}\u26A0${RESET} ${message}`);
}

export function printIssue(message: string): void {
  console.log(`          ${DIM}-${RESET} ${message}`);
}

export function printDetail(message: string): void {
  console.log(`        ${message}`);
}

export function printResult(result: CheckResult): void {
  checkStart(result.name);

  if (result.issues.length === 0) {
    checkSuccess(`${result.filesChecked} files checked, no issues`);
    return;
  }

  const label = result.severity === "warning" ? "warning" : "error";
  const printer = result.severity === "warning" ? checkWarning : checkError;

  printer(`Found ${result.issues.length} ${label}(s):`);

  const limit = 10;
  for (const issue of result.issues.slice(0, limit)) {
    const loc = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    printIssue(`${loc}: ${issue.message}`);
    if (issue.detail) {
      printDetail(`          ${issue.detail}`);
    }
  }

  if (result.issues.length > limit) {
    printIssue(`... and ${result.issues.length - limit} more`);
  }
}

export function printSummary(results: CheckResult[]): void {
  const errors = results.filter((r) => r.severity === "error" && r.issues.length > 0);
  const warnings = results.filter((r) => r.severity === "warning" && r.issues.length > 0);
  const passed = results.filter((r) => r.issues.length === 0);

  console.log(`\n${BOLD}=== Summary ===${RESET}`);
  if (passed.length > 0) {
    console.log(`${GREEN}\u2713${RESET} ${passed.length} check(s) passed`);
  }
  if (warnings.length > 0) {
    console.log(`${YELLOW}\u26A0${RESET} ${warnings.length} warning(s)`);
  }
  if (errors.length > 0) {
    console.log(`${RED}\u2717${RESET} ${errors.length} check(s) failed`);
  }
}

export interface JsonOutput {
  results: CheckResult[];
  totalErrors: number;
  totalWarnings: number;
}

export function printJson(results: CheckResult[]): void {
  const output: JsonOutput = {
    results,
    totalErrors: results.filter((r) => r.severity === "error" && r.issues.length > 0).length,
    totalWarnings: results.filter((r) => r.severity === "warning" && r.issues.length > 0).length,
  };
  console.log(JSON.stringify(output, null, 2));
}
