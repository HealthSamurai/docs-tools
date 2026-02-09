import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { parseSummary } from "../lib/summary";
import { extractH1 } from "../lib/markdown";
import { readFile } from "../lib/files";

/**
 * Normalize title for comparison: strip markdown formatting, collapse whitespace.
 */
function normalizeTitle(title: string): string {
  let t = title;
  // Remove bold
  t = t.replace(/\*\*(.*?)\*\*/g, "$1");
  // Remove italic
  t = t.replace(/\*(.*?)\*/g, "$1");
  // Remove inline code
  t = t.replace(/`(.*?)`/g, "$1");
  // Collapse whitespace
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export const titleMismatch: Check = {
  id: "title-mismatch",
  name: "Title Mismatch",
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

    let checked = 0;

    for (const entry of entries) {
      if (!entry.path.endsWith(".md")) continue;

      const content = await readFile(join(ctx.docsDir, entry.path));
      if (!content) continue;

      checked++;
      const h1 = extractH1(content);
      if (!h1) continue;

      const normalizedSummary = normalizeTitle(entry.title);
      const normalizedH1 = normalizeTitle(h1);

      if (normalizedSummary !== normalizedH1) {
        issues.push({
          file: entry.path,
          message: `SUMMARY title "${entry.title}" != H1 "${h1}"`,
        });
      }
    }

    return {
      checkId: this.id,
      name: this.name,
      severity: this.severity,
      issues,
      filesChecked: checked,
    };
  },
};
