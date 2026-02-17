import { join } from "path";
import type { Check, CheckContext, CheckResult, Config } from "./types";
import { getMarkdownFiles } from "./lib/files";

export async function buildContext(root: string, config: Config): Promise<CheckContext> {
  const docsDir = join(root, config.docs_dir);
  const assetsDir = join(root, config.assets_dir);
  // Try SUMMARY.md in docs dir first, then fall back to repo root
  let summaryPath = join(docsDir, config.summary);
  if (!(await Bun.file(summaryPath).exists())) {
    summaryPath = join(root, config.summary);
  }
  const redirectsPath = join(root, config.redirects);

  const files = await getMarkdownFiles(docsDir, config.exclude);

  return {
    root,
    docsDir,
    assetsDir,
    summaryPath,
    redirectsPath,
    exclude: config.exclude,
    config,
    files,
  };
}

export async function runChecks(
  checks: Check[],
  ctx: CheckContext,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const check of checks) {
    // Override severity if check is in warn_only list
    const effectiveSeverity = ctx.config.checks.warn_only.includes(check.id)
      ? "warning"
      : check.severity;

    const result = await check.run(ctx);
    result.severity = effectiveSeverity;
    results.push(result);
  }

  return results;
}

export function filterChecks(
  allChecks: Check[],
  config: Config,
  only?: string,
): Check[] {
  let checks = allChecks.filter((c) => !config.checks.disable.includes(c.id));

  if (only) {
    checks = checks.filter((c) => c.id === only);
    if (checks.length === 0) {
      throw new Error(`Unknown check: ${only}`);
    }
  }

  return checks;
}
