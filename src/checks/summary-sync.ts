import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { parseSummary, summaryPaths } from "../lib/summary";
import { fileExists } from "../lib/files";
import { join } from "path";

export const summarySync: Check = {
  id: "summary-sync",
  name: "Summary vs Files",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];
    const entries = await parseSummary(ctx.summaryPath);

    if (entries.length === 0) {
      return {
        checkId: this.id,
        name: this.name,
        severity: this.severity,
        issues: [],
        filesChecked: 0,
      };
    }

    const pathsInSummary = summaryPaths(entries);

    // Files on disk (relative to docsDir), excluding SUMMARY.md
    const filesOnDisk = new Set(
      ctx.files.filter((f) => f !== ctx.config.summary),
    );

    // Files on disk not in SUMMARY
    for (const file of filesOnDisk) {
      if (!pathsInSummary.has(file)) {
        issues.push({
          file,
          message: "Not in SUMMARY.md",
        });
      }
    }

    // Paths in SUMMARY not on disk
    for (const entry of entries) {
      if (!entry.path.endsWith(".md")) continue;
      const exists = await fileExists(join(ctx.docsDir, entry.path));
      if (!exists) {
        issues.push({
          file: ctx.config.summary,
          line: entry.lineNum,
          message: `Missing on disk: ${entry.path}`,
        });
      }
    }

    return {
      checkId: this.id,
      name: this.name,
      severity: this.severity,
      issues,
      filesChecked: filesOnDisk.size,
    };
  },
};
