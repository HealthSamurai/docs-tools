import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { contentLines } from "../lib/markdown";
import { readFile } from "../lib/files";

export const h1Headers: Check = {
  id: "h1-headers",
  name: "H1 Headers",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      const h1Lines: number[] = [];
      for (const { line, lineNum } of contentLines(content)) {
        if (/^#\s+/.test(line) && !/^##/.test(line)) {
          h1Lines.push(lineNum);
        }
      }

      if (h1Lines.length > 1) {
        issues.push({
          file,
          line: h1Lines[1],
          message: `Multiple H1 headers (${h1Lines.length} found)`,
        });
      }
    }

    return {
      checkId: this.id,
      name: this.name,
      severity: this.severity,
      issues,
      filesChecked: ctx.files.length,
    };
  },
};
