import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { contentLines } from "../lib/markdown";
import { readFile } from "../lib/files";

export const imageAlt: Check = {
  id: "image-alt",
  name: "Image Alt Text",
  severity: "warning",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      for (const { line, lineNum } of contentLines(content)) {
        // Markdown: ![](path) - empty alt
        if (/!\[\]\([^)]+\)/.test(line)) {
          issues.push({
            file,
            line: lineNum,
            message: "Markdown image without alt text",
          });
        }

        // HTML: <img> without alt or with empty alt
        if (/<img/i.test(line)) {
          // Remove inline code spans before checking
          const withoutCode = line.replace(/`[^`]+`/g, "");
          if (/<img/i.test(withoutCode)) {
            if (/alt\s*=\s*["']\s*["']/i.test(withoutCode)) {
              issues.push({
                file,
                line: lineNum,
                message: "img tag with empty alt",
              });
            } else if (!/alt\s*=/i.test(withoutCode)) {
              issues.push({
                file,
                line: lineNum,
                message: "img tag without alt attribute",
              });
            }
          }
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
