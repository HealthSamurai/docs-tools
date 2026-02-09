import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { contentLines } from "../lib/markdown";
import { readFile } from "../lib/files";

export const brokenReferences: Check = {
  id: "broken-references",
  name: "Broken References",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      for (const { line, lineNum } of contentLines(content)) {
        if (/\[.*?\]\(broken-reference/.test(line)) {
          issues.push({
            file,
            line: lineNum,
            message: "Link points to broken-reference",
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
