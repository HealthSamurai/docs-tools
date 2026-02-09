import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { readFile } from "../lib/files";

export const ampersandSummary: Check = {
  id: "ampersand-summary",
  name: "Ampersand in Summary",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    const content = await readFile(ctx.summaryPath);
    if (!content) {
      return {
        checkId: this.id,
        name: this.name,
        severity: this.severity,
        issues: [],
        filesChecked: 0,
      };
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Only check lines that have markdown link titles
      if (/\[.*?\]/.test(line) && / & /.test(line)) {
        const titleMatch = line.match(/\[([^\]]*)\]/);
        if (titleMatch && titleMatch[1].includes(" & ")) {
          issues.push({
            file: ctx.config.summary,
            line: i + 1,
            message: `Title contains ' & ' — use 'and' instead`,
          });
        }
      }
    }

    return {
      checkId: this.id,
      name: this.name,
      severity: this.severity,
      issues,
      filesChecked: content ? 1 : 0,
    };
  },
};
