import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { extractLinks, isExternal } from "../lib/links";
import { readFile } from "../lib/files";

export const deprecatedLinks: Check = {
  id: "deprecated-links",
  name: "Deprecated Links",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];
    const summaryName = ctx.config.summary;

    // Get per-check config for file exclusions
    const checkConfig = ctx.config.checks["deprecated-links"] as
      | { exclude_files?: string[] }
      | undefined;
    const excludeFiles = checkConfig?.exclude_files ?? [];

    for (const file of ctx.files) {
      // Skip SUMMARY.md, files in deprecated directories, and excluded files
      if (file === summaryName || file.includes("deprecated")) continue;
      if (excludeFiles.some((pattern) => file.includes(pattern))) continue;

      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      for (const link of extractLinks(content)) {
        if (isExternal(link.href)) continue;
        if (/deprecated/i.test(link.href)) {
          issues.push({
            file,
            line: link.lineNum,
            message: `Link to deprecated: [${link.text}](${link.href})`,
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
