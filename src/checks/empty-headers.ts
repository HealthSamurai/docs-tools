import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { contentLines } from "../lib/markdown";
import { readFile } from "../lib/files";

export const emptyHeaders: Check = {
  id: "empty-headers",
  name: "Empty Headers",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      for (const { line, lineNum } of contentLines(content)) {
        if (/^#{2,6}\s*$/.test(line)) {
          issues.push({
            file,
            line: lineNum,
            message: `Empty header: ${line.trim()}`,
          });
        }
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
