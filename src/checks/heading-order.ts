import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { contentLines } from "../lib/markdown";
import { readFile } from "../lib/files";

export const headingOrder: Check = {
  id: "heading-order",
  name: "Heading Order",
  severity: "warning",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      let lastLevel = 0;
      for (const { line, lineNum } of contentLines(content)) {
        const match = line.match(/^(#{1,6})\s/);
        if (!match) continue;

        const level = match[1].length;
        if (lastLevel > 0 && level > lastLevel + 1) {
          issues.push({
            file,
            line: lineNum,
            message: `Heading level skipped: h${lastLevel} -> h${level} (expected h${lastLevel + 1} or lower)`,
          });
        }
        lastLevel = level;
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
